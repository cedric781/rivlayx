import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { reconciliationRuns } from '@rivlayx/db';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { postLedgerTxn } from './post';
import { runReconciliation } from './reconciliation';

let harness: TestDb;

beforeAll(async () => {
  harness = await createTestDb();
});
afterAll(async () => {
  await harness.close();
});
beforeEach(async () => {
  await harness.pg.exec(
    'TRUNCATE auth.users CASCADE; TRUNCATE financial.ledger_entries; ' +
      'TRUNCATE financial.balances; TRUNCATE financial.reconciliation_runs;',
  );
});

async function deposit(userId: string, amount: string): Promise<void> {
  await postLedgerTxn(harness.db, {
    txnId: randomUUID(),
    requestId: randomUUID(),
    createdBy: 'recon-test',
    entries: [
      {
        accountType: 'deposit_holding',
        accountRef: 'platform',
        direction: 'debit',
        amountUsdc: amount,
        reason: 'deposit',
      },
      {
        accountType: 'user_available',
        accountRef: userId,
        direction: 'credit',
        amountUsdc: amount,
        reason: 'deposit',
      },
    ],
  });
}

describe('runReconciliation', () => {
  it('returns ok when ledger is empty', async () => {
    const result = await runReconciliation(harness.db);
    expect(result.status).toBe('ok');
    expect(result.ledgerTotalUsdc).toBe('0.000000');
    expect(result.driftUsdc).toBe('0.000000');
  });

  it('returns ok when ledger is internally consistent and no on-chain check', async () => {
    const u1 = await createTestUser(harness.db);
    const u2 = await createTestUser(harness.db);
    await deposit(u1.id, '100');
    await deposit(u2.id, '50');

    const result = await runReconciliation(harness.db);
    expect(result.status).toBe('ok');
    expect(result.ledgerTotalUsdc).toBe('150.000000');
  });

  it('returns drift when on-chain total disagrees beyond threshold', async () => {
    const u = await createTestUser(harness.db);
    await deposit(u.id, '100');

    const result = await runReconciliation(harness.db, { onChainTotalUsdc: '99.50' });
    expect(result.status).toBe('drift');
    expect(result.driftUsdc).toBe('0.500000');
    expect(result.details['on_chain']).toBe('99.500000');
  });

  it('accepts on-chain within threshold (≤ 0.01)', async () => {
    const u = await createTestUser(harness.db);
    await deposit(u.id, '100');

    const result = await runReconciliation(harness.db, { onChainTotalUsdc: '99.99' });
    expect(result.status).toBe('ok');
  });

  it('persists a row in reconciliation_runs every call', async () => {
    await runReconciliation(harness.db);
    await runReconciliation(harness.db, { onChainTotalUsdc: '0' });
    const rows = await harness.db.select().from(reconciliationRuns);
    expect(rows).toHaveLength(2);
  });

  // Proves the C1-era fix: the on-chain comparison targets the deposit_holding
  // balance, NOT cumulative credit volume. An internal transfer inflates total
  // credits without touching the vault asset — the old Σcredits comparison
  // would false-flag drift here; the corrected one must not.
  describe('on-chain compares against deposit_holding, not credit volume', () => {
    async function depositPlusInternalMove(): Promise<void> {
      const u1 = await createTestUser(harness.db);
      const u2 = await createTestUser(harness.db);
      await deposit(u1.id, '100'); // deposit_holding +100, credits +100
      // Internal user→user transfer: +30 credit, +30 debit, vault untouched.
      await postLedgerTxn(harness.db, {
        txnId: randomUUID(),
        requestId: randomUUID(),
        createdBy: 'recon-test',
        entries: [
          {
            accountType: 'user_available',
            accountRef: u1.id,
            direction: 'debit',
            amountUsdc: '30',
            reason: 'adjustment',
          },
          {
            accountType: 'user_available',
            accountRef: u2.id,
            direction: 'credit',
            amountUsdc: '30',
            reason: 'adjustment',
          },
        ],
      });
    }

    it('reports ok when on-chain equals deposit_holding despite inflated credits', async () => {
      await depositPlusInternalMove();
      // credit volume is now 130, but vault ledger (deposit_holding) is 100.
      const result = await runReconciliation(harness.db, { onChainTotalUsdc: '100' });
      expect(result.status).toBe('ok');
      expect(result.ledgerTotalUsdc).toBe('100.000000');
      expect(result.driftUsdc).toBe('0.000000');
    });

    it('detects real drift against deposit_holding (vault short by 5)', async () => {
      await depositPlusInternalMove();
      const result = await runReconciliation(harness.db, { onChainTotalUsdc: '95' });
      expect(result.status).toBe('drift');
      expect(result.driftUsdc).toBe('5.000000');
    });
  });
});
