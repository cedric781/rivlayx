import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { balances, withdrawalRequests } from '@rivlayx/db';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { requestWithdrawal } from './request';

// Canonical wrapped-SOL mint — a known-valid base58 Solana address.
const DEST = 'So11111111111111111111111111111111111111112';

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
      'TRUNCATE financial.withdrawal_requests CASCADE; ' +
      'TRUNCATE financial.balances CASCADE; ' +
      'TRUNCATE financial.freeze_state CASCADE; ' +
      "INSERT INTO financial.freeze_state (component) VALUES ('new_bets'), ('settlements'), ('withdrawals'), ('all');",
  );
});

/** Create a user with a seeded available balance projection. */
async function fundedUser(availableUsdc = '100') {
  const u = await createTestUser(harness.db);
  await harness.db.insert(balances).values({ userId: u.id, availableUsdc, lockedUsdc: '0' });
  return u.id;
}

describe('requestWithdrawal', () => {
  it('persists a pending_review request with a balance snapshot', async () => {
    const userId = await fundedUser('100');

    const r = await requestWithdrawal(harness.db, {
      userId,
      amountUsdc: '10',
      destinationWallet: DEST,
    });

    expect(r.status).toBe('pending_review');
    expect(Number(r.amountUsdc)).toBe(10);
    expect(r.destinationWallet).toBe(DEST);
    expect(Number(r.availableAtRequestUsdc)).toBe(100); // snapshot, not a hold

    const rows = await harness.db
      .select()
      .from(withdrawalRequests)
      .where(eq(withdrawalRequests.userId, userId));
    expect(rows.length).toBe(1);
  });

  it('rejects above the per-withdrawal cap before any row is written', async () => {
    const userId = await fundedUser('1000');
    await expect(
      requestWithdrawal(harness.db, { userId, amountUsdc: '50', destinationWallet: DEST }),
    ).rejects.toMatchObject({ code: 'AMOUNT_EXCEEDS_CAP' });

    const rows = await harness.db.select().from(withdrawalRequests);
    expect(rows.length).toBe(0);
  });

  it('rejects when the amount exceeds available balance', async () => {
    const userId = await fundedUser('5');
    await expect(
      requestWithdrawal(harness.db, { userId, amountUsdc: '20', destinationWallet: DEST }),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
  });

  it('rejects when withdrawals are frozen', async () => {
    const userId = await fundedUser('100');
    await harness.pg.exec(
      "UPDATE financial.freeze_state SET frozen = true WHERE component = 'withdrawals';",
    );
    await expect(
      requestWithdrawal(harness.db, { userId, amountUsdc: '10', destinationWallet: DEST }),
    ).rejects.toMatchObject({ code: 'FROZEN' });
  });
});

describe('requestWithdrawal — one open request per user', () => {
  it('blocks a second request while one is still pending_review', async () => {
    const userId = await fundedUser('100');
    await requestWithdrawal(harness.db, { userId, amountUsdc: '10', destinationWallet: DEST });

    await expect(
      requestWithdrawal(harness.db, { userId, amountUsdc: '5', destinationWallet: DEST }),
    ).rejects.toMatchObject({ code: 'OPEN_REQUEST_EXISTS' });

    const rows = await harness.db
      .select()
      .from(withdrawalRequests)
      .where(eq(withdrawalRequests.userId, userId));
    expect(rows.length).toBe(1); // the second request was never written
  });

  it('blocks while a prior request is approved or processing (not yet terminal)', async () => {
    const userId = await fundedUser('100');
    const first = await requestWithdrawal(harness.db, {
      userId,
      amountUsdc: '10',
      destinationWallet: DEST,
    });

    for (const status of ['approved', 'processing'] as const) {
      await harness.db
        .update(withdrawalRequests)
        .set({ status })
        .where(eq(withdrawalRequests.id, first.id));
      await expect(
        requestWithdrawal(harness.db, { userId, amountUsdc: '5', destinationWallet: DEST }),
      ).rejects.toMatchObject({ code: 'OPEN_REQUEST_EXISTS' });
    }
  });

  it('allows a new request once the prior one reaches a terminal state', async () => {
    const userId = await fundedUser('100');
    const first = await requestWithdrawal(harness.db, {
      userId,
      amountUsdc: '10',
      destinationWallet: DEST,
    });
    await harness.db
      .update(withdrawalRequests)
      .set({ status: 'rejected' })
      .where(eq(withdrawalRequests.id, first.id));

    const second = await requestWithdrawal(harness.db, {
      userId,
      amountUsdc: '5',
      destinationWallet: DEST,
    });
    expect(second.status).toBe('pending_review');
  });

  it('scopes the open-request guard per user', async () => {
    const a = await fundedUser('100');
    const b = await fundedUser('100');
    await requestWithdrawal(harness.db, { userId: a, amountUsdc: '10', destinationWallet: DEST });

    // b has no open request, so b is unaffected by a's pending request.
    const r = await requestWithdrawal(harness.db, {
      userId: b,
      amountUsdc: '10',
      destinationWallet: DEST,
    });
    expect(r.status).toBe('pending_review');
  });
});
