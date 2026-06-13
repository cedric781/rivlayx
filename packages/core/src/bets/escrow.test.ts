import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { getBalance } from '../ledger/balances';
import {
  lockCreationFee,
  lockStakeForParticipant,
  recognizeCreationFee,
  refundCreationFee,
  refundStakeToParticipant,
} from './escrow';
import { fundUser } from './test-helpers';

let harness: TestDb;

beforeAll(async () => {
  harness = await createTestDb();
});
afterAll(async () => {
  await harness.close();
});
beforeEach(async () => {
  await harness.pg.exec(
    'TRUNCATE auth.users CASCADE; ' +
      'TRUNCATE financial.ledger_entries; TRUNCATE financial.balances;',
  );
});

describe('lockStakeForParticipant + refundStakeToParticipant', () => {
  it('moves user_available → bet_escrow (locked) and back', async () => {
    const user = await createTestUser(harness.db);
    await fundUser(harness.db, user.id, '100');
    const betId = randomUUID();

    await harness.db.transaction(async (tx) => {
      await lockStakeForParticipant(tx, { betId, userId: user.id, amountUsdc: '25' });
    });

    let balance = await getBalance(harness.db, user.id);
    expect(balance?.availableUsdc).toBe('75.000000');
    expect(balance?.lockedUsdc).toBe('25.000000');

    await harness.db.transaction(async (tx) => {
      await refundStakeToParticipant(tx, { betId, userId: user.id, amountUsdc: '25' });
    });

    balance = await getBalance(harness.db, user.id);
    expect(balance?.availableUsdc).toBe('100.000000');
    expect(balance?.lockedUsdc).toBe('0.000000');
  });

  it('refuses to push available below zero (CHECK constraint catches it)', async () => {
    const user = await createTestUser(harness.db);
    await fundUser(harness.db, user.id, '10');
    const betId = randomUUID();

    await expect(
      harness.db.transaction(async (tx) => {
        await lockStakeForParticipant(tx, { betId, userId: user.id, amountUsdc: '20' });
      }),
    ).rejects.toThrow(/balances_available_non_negative|check constraint/i);
  });
});

describe('creation fee lifecycle', () => {
  it('lock → recognize moves held fee to platform_fee', async () => {
    const user = await createTestUser(harness.db);
    await fundUser(harness.db, user.id, '10');
    const betId = randomUUID();

    await harness.db.transaction(async (tx) => {
      await lockCreationFee(tx, { betId, creatorUserId: user.id, amountUsdc: '0.5' });
    });
    let balance = await getBalance(harness.db, user.id);
    expect(balance?.availableUsdc).toBe('9.500000');
    expect(balance?.lockedUsdc).toBe('0.500000');

    await harness.db.transaction(async (tx) => {
      await recognizeCreationFee(tx, { betId, creatorUserId: user.id, amountUsdc: '0.5' });
    });
    balance = await getBalance(harness.db, user.id);
    // Fee is recognized to platform → user's locked frees up but funds are gone.
    expect(balance?.availableUsdc).toBe('9.500000');
    expect(balance?.lockedUsdc).toBe('0.000000');
  });

  it('lock → refund returns the fee to the creator', async () => {
    const user = await createTestUser(harness.db);
    await fundUser(harness.db, user.id, '10');
    const betId = randomUUID();

    await harness.db.transaction(async (tx) => {
      await lockCreationFee(tx, { betId, creatorUserId: user.id, amountUsdc: '0.5' });
    });
    await harness.db.transaction(async (tx) => {
      await refundCreationFee(tx, { betId, creatorUserId: user.id, amountUsdc: '0.5' });
    });
    const balance = await getBalance(harness.db, user.id);
    expect(balance?.availableUsdc).toBe('10.000000');
    expect(balance?.lockedUsdc).toBe('0.000000');
  });
});
