import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { postLedgerTxn } from './post';
import { getBalance, recomputeBalance } from './balances';

let harness: TestDb;

beforeAll(async () => {
  harness = await createTestDb();
});
afterAll(async () => {
  await harness.close();
});
beforeEach(async () => {
  await harness.pg.exec(
    'TRUNCATE auth.users CASCADE; TRUNCATE financial.ledger_entries; TRUNCATE financial.balances;',
  );
});

describe('recomputeBalance', () => {
  it('agrees with the denormalised balances row after a series of ops', async () => {
    const user = await createTestUser(harness.db);
    const betId = randomUUID();

    // Deposit 100
    await postLedgerTxn(harness.db, {
      txnId: randomUUID(),
      requestId: randomUUID(),
      createdBy: 'test',
      entries: [
        {
          accountType: 'deposit_holding',
          accountRef: 'platform',
          direction: 'debit',
          amountUsdc: '100',
          reason: 'deposit',
        },
        {
          accountType: 'user_available',
          accountRef: user.id,
          direction: 'credit',
          amountUsdc: '100',
          reason: 'deposit',
        },
      ],
    });

    // Lock 25 in bet escrow
    await postLedgerTxn(harness.db, {
      txnId: randomUUID(),
      requestId: randomUUID(),
      createdBy: 'test',
      entries: [
        {
          accountType: 'user_available',
          accountRef: user.id,
          direction: 'debit',
          amountUsdc: '25',
          reason: 'stake_lock',
        },
        {
          accountType: 'bet_escrow',
          accountRef: betId,
          direction: 'credit',
          amountUsdc: '25',
          reason: 'stake_lock',
          affectsUserId: user.id,
          betId,
        },
      ],
    });

    const denormalised = await getBalance(harness.db, user.id);
    const recomputed = await recomputeBalance(harness.db, user.id);

    expect(denormalised?.availableUsdc).toBe(recomputed.availableUsdc);
    expect(denormalised?.lockedUsdc).toBe(recomputed.lockedUsdc);
    expect(recomputed.availableUsdc).toBe('75.000000');
    expect(recomputed.lockedUsdc).toBe('25.000000');
  });

  it('returns zero for a user with no ledger entries', async () => {
    const user = await createTestUser(harness.db);
    const recomputed = await recomputeBalance(harness.db, user.id);
    expect(recomputed.availableUsdc).toBe('0.000000');
    expect(recomputed.lockedUsdc).toBe('0.000000');
  });

  it('handles unlock (escrow debit) reducing locked balance', async () => {
    const user = await createTestUser(harness.db);
    const betId = randomUUID();

    await postLedgerTxn(harness.db, {
      txnId: randomUUID(),
      requestId: randomUUID(),
      createdBy: 'test',
      entries: [
        {
          accountType: 'deposit_holding',
          accountRef: 'platform',
          direction: 'debit',
          amountUsdc: '50',
          reason: 'deposit',
        },
        {
          accountType: 'user_available',
          accountRef: user.id,
          direction: 'credit',
          amountUsdc: '50',
          reason: 'deposit',
        },
      ],
    });
    // Lock 25
    await postLedgerTxn(harness.db, {
      txnId: randomUUID(),
      requestId: randomUUID(),
      createdBy: 'test',
      entries: [
        {
          accountType: 'user_available',
          accountRef: user.id,
          direction: 'debit',
          amountUsdc: '25',
          reason: 'stake_lock',
        },
        {
          accountType: 'bet_escrow',
          accountRef: betId,
          direction: 'credit',
          amountUsdc: '25',
          reason: 'stake_lock',
          affectsUserId: user.id,
        },
      ],
    });
    // Unlock 25 (refund path)
    await postLedgerTxn(harness.db, {
      txnId: randomUUID(),
      requestId: randomUUID(),
      createdBy: 'test',
      entries: [
        {
          accountType: 'bet_escrow',
          accountRef: betId,
          direction: 'debit',
          amountUsdc: '25',
          reason: 'stake_unlock_refund',
          affectsUserId: user.id,
        },
        {
          accountType: 'user_available',
          accountRef: user.id,
          direction: 'credit',
          amountUsdc: '25',
          reason: 'stake_unlock_refund',
        },
      ],
    });

    const balance = await getBalance(harness.db, user.id);
    expect(balance?.availableUsdc).toBe('50.000000');
    expect(balance?.lockedUsdc).toBe('0.000000');
  });
});
