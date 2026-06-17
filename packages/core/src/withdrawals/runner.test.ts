import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { ledgerEntries, withdrawalRequests, adminAuditLog } from '@rivlayx/db';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { fundUser } from '../bets/test-helpers';
import { getBalance } from '../ledger/balances';
import { runReconciliation } from '../ledger/reconciliation';
import { setFreeze } from '../ledger/freeze';
import { MockSolanaTransferProvider } from '../payouts/transfer-mock';
import { processOneWithdrawal, processWithdrawalQueue } from './runner';
import { approveWithdrawal, rejectWithdrawal } from './approve';

const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

const DEST = 'So11111111111111111111111111111111111111112';
let harness: TestDb;
let provider: MockSolanaTransferProvider;

beforeAll(async () => {
  harness = await createTestDb();
});
afterAll(async () => {
  await harness.close();
});
beforeEach(async () => {
  await harness.pg.exec(
    'TRUNCATE auth.users CASCADE; ' +
      'TRUNCATE financial.ledger_entries; TRUNCATE financial.balances; ' +
      'TRUNCATE financial.withdrawal_requests CASCADE; ' +
      'TRUNCATE financial.freeze_state CASCADE; ' +
      "INSERT INTO financial.freeze_state (component) VALUES ('new_bets'), ('settlements'), ('withdrawals'), ('all');",
  );
  provider = new MockSolanaTransferProvider();
});

async function fundedUser(amount = '100') {
  const u = await createTestUser(harness.db);
  await fundUser(harness.db, u.id, amount);
  return u.id;
}
async function admin() {
  return (await createTestUser(harness.db)).id;
}

async function insertWithdrawal(
  userId: string,
  adminId: string | null,
  amount: string,
  status: string,
  overrides: Record<string, unknown> = {},
) {
  const [row] = await harness.db
    .insert(withdrawalRequests)
    .values({
      userId,
      amountUsdc: amount,
      destinationWallet: DEST,
      status: status as 'approved',
      availableAtRequestUsdc: amount,
      reviewedByUserId: adminId,
      reviewedAt: adminId ? new Date() : null,
      nextAttemptAt: new Date(Date.now() - 60_000),
      ...overrides,
    })
    .returning();
  return row!;
}

describe('processOneWithdrawal — happy path', () => {
  it('pays an approved withdrawal: transfer, ledger debit, status=paid', async () => {
    const userId = await fundedUser('100');
    const adminId = await admin();
    const wr = await insertWithdrawal(userId, adminId, '25', 'approved');

    const r = await processOneWithdrawal(harness.db, provider, wr.id);
    expect(r.kind).toBe('paid');

    const [row] = await harness.db
      .select()
      .from(withdrawalRequests)
      .where(eq(withdrawalRequests.id, wr.id));
    expect(row!.status).toBe('paid');
    expect(row!.txSignature).toBeTruthy();
    expect(row!.ledgerTxnId).toBeTruthy();
    expect(row!.paidAt).toBeTruthy();

    const bal = await getBalance(harness.db, userId);
    expect(bal!.availableUsdc).toBe('75.000000'); // 100 − 25

    const recon = await runReconciliation(harness.db);
    expect(recon.status).toBe('ok'); // Σdebit == Σcredit
  });

  it('writes a withdrawal.paid admin audit row attributed to the approver', async () => {
    const userId = await fundedUser('100');
    const adminId = await admin();
    const wr = await insertWithdrawal(userId, adminId, '10', 'approved');
    await processOneWithdrawal(harness.db, provider, wr.id);

    const audit = await harness.db
      .select()
      .from(adminAuditLog)
      .where(and(eq(adminAuditLog.targetId, wr.id), eq(adminAuditLog.action, 'withdrawal.paid')));
    expect(audit.length).toBe(1);
    expect(audit[0]!.actorUserId).toBe(adminId);
  });
});

describe('idempotency / no double payout', () => {
  it('a second run is a no-op: balance + ledger unchanged', async () => {
    const userId = await fundedUser('100');
    const adminId = await admin();
    const wr = await insertWithdrawal(userId, adminId, '20', 'approved');

    const first = await processOneWithdrawal(harness.db, provider, wr.id);
    expect(first.kind).toBe('paid');
    const entriesAfterFirst = await harness.db.select().from(ledgerEntries);
    const balAfterFirst = (await getBalance(harness.db, userId))!.availableUsdc;

    const second = await processOneWithdrawal(harness.db, provider, wr.id);
    expect(second.kind).toBe('skipped'); // status is no longer 'approved'

    const entriesAfterSecond = await harness.db.select().from(ledgerEntries);
    const balAfterSecond = (await getBalance(harness.db, userId))!.availableUsdc;
    expect(entriesAfterSecond.length).toBe(entriesAfterFirst.length);
    expect(balAfterSecond).toBe(balAfterFirst);
    expect(balAfterSecond).toBe('80.000000');
  });
});

describe('freeze aware', () => {
  it('skips the whole queue when withdrawals are frozen; row stays approved', async () => {
    const userId = await fundedUser('100');
    const adminId = await admin();
    const wr = await insertWithdrawal(userId, adminId, '15', 'approved');
    await setFreeze(harness.db, 'withdrawals', true, { actorUserId: null, reason: 'test' });

    const res = await processWithdrawalQueue(harness.db, provider);
    expect(res.skippedFrozen).toBe(true);

    const [row] = await harness.db
      .select()
      .from(withdrawalRequests)
      .where(eq(withdrawalRequests.id, wr.id));
    expect(row!.status).toBe('approved');
    expect((await getBalance(harness.db, userId))!.availableUsdc).toBe('100.000000');
  });
});

describe('caps enforced at process time', () => {
  it('fails an over-cap (>25) approved row without paying', async () => {
    const userId = await fundedUser('100');
    const adminId = await admin();
    const wr = await insertWithdrawal(userId, adminId, '50', 'approved');

    const r = await processOneWithdrawal(harness.db, provider, wr.id);
    expect(r.kind).toBe('permanent_failure');
    const [row] = await harness.db
      .select()
      .from(withdrawalRequests)
      .where(eq(withdrawalRequests.id, wr.id));
    expect(row!.status).toBe('failed');
    expect((await getBalance(harness.db, userId))!.availableUsdc).toBe('100.000000');
  });

  it('fails when the rolling daily cap would be exceeded', async () => {
    const userId = await fundedUser('200');
    const adminId = await admin();
    await insertWithdrawal(userId, adminId, '80', 'paid'); // counts toward 24h total
    const wr = await insertWithdrawal(userId, adminId, '25', 'approved'); // 80 + 25 > 100

    const r = await processOneWithdrawal(harness.db, provider, wr.id);
    expect(r.kind).toBe('permanent_failure');
    const [row] = await harness.db
      .select()
      .from(withdrawalRequests)
      .where(eq(withdrawalRequests.id, wr.id));
    expect(row!.status).toBe('failed');
    expect(row!.lastError).toMatch(/daily cap/i);
  });
});

describe('transfer failures', () => {
  it('retryable failure → back to approved with backoff, then pays on retry', async () => {
    const userId = await fundedUser('100');
    const adminId = await admin();
    const wr = await insertWithdrawal(userId, adminId, '10', 'approved');
    provider.setRetryableFailure(wr.id, 1);

    const now = new Date();
    const r1 = await processOneWithdrawal(harness.db, provider, wr.id, { now });
    expect(r1.kind).toBe('retryable_failure');
    let [row] = await harness.db
      .select()
      .from(withdrawalRequests)
      .where(eq(withdrawalRequests.id, wr.id));
    expect(row!.status).toBe('approved');
    expect(row!.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime());

    const later = new Date(now.getTime() + 60 * 60 * 1000);
    const r2 = await processOneWithdrawal(harness.db, provider, wr.id, { now: later });
    expect(r2.kind).toBe('paid');
    [row] = await harness.db
      .select()
      .from(withdrawalRequests)
      .where(eq(withdrawalRequests.id, wr.id));
    expect(row!.status).toBe('paid');
    expect((await getBalance(harness.db, userId))!.availableUsdc).toBe('90.000000');
  });

  it('permanent failure → status=failed, no debit', async () => {
    const userId = await fundedUser('100');
    const adminId = await admin();
    const wr = await insertWithdrawal(userId, adminId, '10', 'approved');
    provider.setPermanentFailure(wr.id, 'bad destination');

    const r = await processOneWithdrawal(harness.db, provider, wr.id);
    expect(r.kind).toBe('permanent_failure');
    const [row] = await harness.db
      .select()
      .from(withdrawalRequests)
      .where(eq(withdrawalRequests.id, wr.id));
    expect(row!.status).toBe('failed');
    expect((await getBalance(harness.db, userId))!.availableUsdc).toBe('100.000000');
  });
});

describe('approveWithdrawal', () => {
  it('moves pending_review → approved within caps + writes audit', async () => {
    const userId = await fundedUser('100');
    const adminId = await admin();
    const wr = await insertWithdrawal(userId, null, '20', 'pending_review', {
      reviewedByUserId: null,
      reviewedAt: null,
    });

    const updated = await approveWithdrawal(harness.db, {
      requestId: wr.id,
      adminUserId: adminId,
      actorRole: 'admin',
    });
    expect(updated.status).toBe('approved');
    expect(updated.reviewedByUserId).toBe(adminId);

    const audit = await harness.db
      .select()
      .from(adminAuditLog)
      .where(and(eq(adminAuditLog.targetId, wr.id), eq(adminAuditLog.action, 'withdrawal.approve')));
    expect(audit.length).toBe(1);
  });

  it('rejects approval of an over-cap request', async () => {
    const userId = await fundedUser('100');
    const adminId = await admin();
    const wr = await insertWithdrawal(userId, null, '50', 'pending_review', {
      reviewedByUserId: null,
      reviewedAt: null,
    });
    await expect(
      approveWithdrawal(harness.db, { requestId: wr.id, adminUserId: adminId }),
    ).rejects.toMatchObject({ code: 'AMOUNT_EXCEEDS_CAP' });
  });
});

describe('rejectWithdrawal', () => {
  it('moves pending_review → rejected, records the reason + audit', async () => {
    const userId = await fundedUser('100');
    const adminId = await admin();
    const wr = await insertWithdrawal(userId, null, '20', 'pending_review', {
      reviewedByUserId: null,
      reviewedAt: null,
    });

    const updated = await rejectWithdrawal(harness.db, {
      requestId: wr.id,
      adminUserId: adminId,
      actorRole: 'admin',
      reason: 'unverified destination wallet',
    });
    expect(updated.status).toBe('rejected');
    expect(updated.reviewedByUserId).toBe(adminId);
    expect(updated.reviewNotes).toBe('unverified destination wallet');

    const audit = await harness.db
      .select()
      .from(adminAuditLog)
      .where(and(eq(adminAuditLog.targetId, wr.id), eq(adminAuditLog.action, 'withdrawal.reject')));
    expect(audit.length).toBe(1);
    expect(audit[0]!.actorUserId).toBe(adminId);

    // No money moved — balance untouched.
    expect((await getBalance(harness.db, userId))!.availableUsdc).toBe('100.000000');
  });

  it('refuses to reject a row that is not pending_review', async () => {
    const userId = await fundedUser('100');
    const adminId = await admin();
    const wr = await insertWithdrawal(userId, adminId, '10', 'approved');

    await expect(
      rejectWithdrawal(harness.db, { requestId: wr.id, adminUserId: adminId }),
    ).rejects.toMatchObject({ code: 'WRONG_STATUS' });
  });

  it('throws NOT_FOUND for an unknown request id', async () => {
    const adminId = await admin();
    await expect(
      rejectWithdrawal(harness.db, { requestId: UNKNOWN_ID, adminUserId: adminId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
