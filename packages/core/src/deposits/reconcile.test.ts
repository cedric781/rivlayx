import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { reconciliationRuns } from '@rivlayx/db';
import { MockHeliusRpc } from '@rivlayx/helius';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { postLedgerTxn } from '../ledger/post';
import { reconcileVault } from './reconcile';

const VAULT_ATA = 'VaultAta1111111111111111111111111111111111';

let harness: TestDb;
let rpc: MockHeliusRpc;

beforeAll(async () => {
  harness = await createTestDb();
});
afterAll(async () => {
  await harness.close();
});
beforeEach(async () => {
  rpc = new MockHeliusRpc();
  await harness.pg.exec(
    'TRUNCATE auth.users CASCADE; TRUNCATE financial.ledger_entries; ' +
      'TRUNCATE financial.balances; TRUNCATE financial.deposits; ' +
      'TRUNCATE financial.reconciliation_runs;',
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
        accountRef: 'vault',
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

function setVaultBalance(amount: string): void {
  rpc.setTokenAccountBalance(VAULT_ATA, {
    amount: (Number(amount) * 1_000_000).toFixed(0),
    decimals: 6,
    uiAmount: Number(amount),
    uiAmountString: amount,
  });
}

describe('reconcileVault', () => {
  it('reports ok when on-chain matches ledger and no in-flight deposits', async () => {
    const user = await createTestUser(harness.db);
    await deposit(user.id, '100');
    setVaultBalance('100');

    const result = await reconcileVault(harness.db, { vaultAta: VAULT_ATA, rpc });
    expect(result.status).toBe('ok');
    expect(result.driftUsdc).toBe('0.000000');
  });

  it('subtracts in-flight pending deposits from on-chain', async () => {
    const user = await createTestUser(harness.db);
    await deposit(user.id, '100');
    // Vault holds 100 + 50 still-pending (not yet credited) = 150 on-chain
    setVaultBalance('150');
    // Insert an in-flight pending deposit row directly
    await harness.pg.exec(`
      INSERT INTO financial.deposits (id, user_id, source_wallet, tx_signature, amount_usdc, status)
      VALUES (gen_random_uuid(), '${user.id}', 'SourceX111111111111111111111111111111', 'sig-x', '50', 'pending');
    `);

    const result = await reconcileVault(harness.db, { vaultAta: VAULT_ATA, rpc });
    // effective_on_chain = 150 − 50 = 100 = ledger credit total → ok
    expect(result.status).toBe('ok');
    expect(result.onChainTotalUsdc).toBe('100.000000');
  });

  it('flags drift when effective on-chain ≠ ledger by > 0.01', async () => {
    const user = await createTestUser(harness.db);
    await deposit(user.id, '100');
    setVaultBalance('99'); // 1 USDC missing — drift!

    const result = await reconcileVault(harness.db, { vaultAta: VAULT_ATA, rpc });
    expect(result.status).toBe('drift');
    expect(result.driftUsdc).toBe('1.000000');
  });

  it('records a row in reconciliation_runs', async () => {
    setVaultBalance('0');
    await reconcileVault(harness.db, { vaultAta: VAULT_ATA, rpc });

    const rows = await harness.db.select().from(reconciliationRuns);
    expect(rows).toHaveLength(1);
  });
});
