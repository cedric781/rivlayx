import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { postLedgerTxn } from '../ledger/post';
import { computeCurrentTvl, wouldExceedTvlCap } from './tvl';

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

async function deposit(userId: string, amount: string): Promise<void> {
  await postLedgerTxn(harness.db, {
    txnId: randomUUID(),
    requestId: randomUUID(),
    createdBy: 'tvl-test',
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

describe('computeCurrentTvl', () => {
  it('is zero on empty ledger', async () => {
    const tvl = await computeCurrentTvl(harness.db);
    expect(tvl).toBe('0.000000');
  });

  it('matches sum of deposits credited to users', async () => {
    const a = await createTestUser(harness.db);
    const b = await createTestUser(harness.db);
    await deposit(a.id, '100');
    await deposit(b.id, '50');
    const tvl = await computeCurrentTvl(harness.db);
    expect(tvl).toBe('150.000000');
  });

  it('is unchanged when funds move user_available → bet_escrow (still user-owed)', async () => {
    const user = await createTestUser(harness.db);
    await deposit(user.id, '100');
    const before = await computeCurrentTvl(harness.db);

    // Lock 30 in a synthetic bet escrow
    const betId = randomUUID();
    await postLedgerTxn(harness.db, {
      txnId: randomUUID(),
      requestId: randomUUID(),
      createdBy: 'tvl-test',
      entries: [
        {
          accountType: 'user_available',
          accountRef: user.id,
          direction: 'debit',
          amountUsdc: '30',
          reason: 'stake_lock',
        },
        {
          accountType: 'bet_escrow',
          accountRef: betId,
          direction: 'credit',
          amountUsdc: '30',
          reason: 'stake_lock',
          affectsUserId: user.id,
        },
      ],
    });

    const after = await computeCurrentTvl(harness.db);
    expect(after).toBe(before);
    expect(after).toBe('100.000000');
  });

  it('does not count platform_fee', async () => {
    const user = await createTestUser(harness.db);
    await deposit(user.id, '100');
    // Recognise a creation fee of 0.5 to platform (debit user_available, credit platform_fee)
    await postLedgerTxn(harness.db, {
      txnId: randomUUID(),
      requestId: randomUUID(),
      createdBy: 'tvl-test',
      entries: [
        {
          accountType: 'user_available',
          accountRef: user.id,
          direction: 'debit',
          amountUsdc: '0.5',
          reason: 'creation_fee_recognize',
        },
        {
          accountType: 'platform_fee',
          accountRef: 'platform',
          direction: 'credit',
          amountUsdc: '0.5',
          reason: 'creation_fee_recognize',
        },
      ],
    });
    const tvl = await computeCurrentTvl(harness.db);
    expect(tvl).toBe('99.500000');
  });
});

describe('wouldExceedTvlCap', () => {
  it('passes when adding amount keeps TVL under cap', async () => {
    const user = await createTestUser(harness.db);
    await deposit(user.id, '500');
    const result = await wouldExceedTvlCap(harness.db, '400', '1000');
    expect(result.exceeds).toBe(false);
    expect(result.afterTvl).toBe('900.000000');
  });

  it('rejects when adding amount would breach cap', async () => {
    const user = await createTestUser(harness.db);
    await deposit(user.id, '900');
    const result = await wouldExceedTvlCap(harness.db, '200', '1000');
    expect(result.exceeds).toBe(true);
    expect(result.afterTvl).toBe('1100.000000');
  });

  it('allows exactly hitting cap (equality is OK)', async () => {
    const user = await createTestUser(harness.db);
    await deposit(user.id, '800');
    const result = await wouldExceedTvlCap(harness.db, '200', '1000');
    expect(result.exceeds).toBe(false);
    expect(result.afterTvl).toBe('1000.000000');
  });
});
