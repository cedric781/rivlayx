import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { ledgerEntries } from '@rivlayx/db';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { getBalance } from '../ledger/balances';
import { forfeitDisputeDeposit, lockDisputeDeposit, refundDisputeDeposit } from './dispute-escrow';
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

describe('dispute escrow ops', () => {
  it('lock → refund returns opener to original balance', async () => {
    const user = await createTestUser(harness.db);
    await fundUser(harness.db, user.id, '100');
    const betId = randomUUID();

    await harness.db.transaction(async (tx) => {
      await lockDisputeDeposit(tx, { betId, openerUserId: user.id, amountUsdc: '15' });
    });
    let balance = await getBalance(harness.db, user.id);
    expect(balance?.availableUsdc).toBe('85.000000');
    expect(balance?.lockedUsdc).toBe('15.000000');

    await harness.db.transaction(async (tx) => {
      await refundDisputeDeposit(tx, { betId, openerUserId: user.id, amountUsdc: '15' });
    });
    balance = await getBalance(harness.db, user.id);
    expect(balance?.availableUsdc).toBe('100.000000');
    expect(balance?.lockedUsdc).toBe('0.000000');
  });

  it('lock → forfeit sends deposit to platform_fee (opener loses it)', async () => {
    const user = await createTestUser(harness.db);
    await fundUser(harness.db, user.id, '100');
    const betId = randomUUID();

    await harness.db.transaction(async (tx) => {
      await lockDisputeDeposit(tx, { betId, openerUserId: user.id, amountUsdc: '15' });
    });
    await harness.db.transaction(async (tx) => {
      await forfeitDisputeDeposit(tx, { betId, openerUserId: user.id, amountUsdc: '15' });
    });

    const balance = await getBalance(harness.db, user.id);
    expect(balance?.availableUsdc).toBe('85.000000');
    expect(balance?.lockedUsdc).toBe('0.000000');

    // Platform fee receives the forfeit
    const [platformRow] = await harness.db
      .select({
        sum: sql<string>`COALESCE(SUM(CASE WHEN ${ledgerEntries.direction} = 'credit' THEN ${ledgerEntries.amountUsdc} ELSE 0 END), 0)`,
      })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.accountType, 'platform_fee'));
    expect(Number(platformRow?.sum)).toBe(15);
  });

  it('refuses to lock more than available (CHECK constraint guards)', async () => {
    const user = await createTestUser(harness.db);
    await fundUser(harness.db, user.id, '5');
    const betId = randomUUID();

    await expect(
      harness.db.transaction(async (tx) => {
        await lockDisputeDeposit(tx, { betId, openerUserId: user.id, amountUsdc: '10' });
      }),
    ).rejects.toThrow(/balances_available_non_negative|check constraint/i);
  });
});
