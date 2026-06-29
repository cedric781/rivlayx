import { eq } from 'drizzle-orm';
import { withdrawalRequests, type WithdrawalRequest } from '@rivlayx/db';
import { logAdminAction } from '../admin/audit-log';
import { isFrozen } from '../ledger/freeze';
import { getBalance } from '../ledger/balances';
import type { LedgerDb } from '../ledger/types';
import { WithdrawalError } from './errors';
import {
  WITHDRAWAL_LIMITS,
  checkDailyCap,
  checkWithdrawalAmount,
  coversAmount,
  type WithdrawalLimits,
} from './cap';
import { withdrawnLast24hUsdc } from './query';

export interface ApproveWithdrawalInput {
  requestId: string;
  adminUserId: string;
  actorRole?: string | null;
  now?: Date;
  /** Cap source. Defaults to WITHDRAWAL_LIMITS when the caller passes none. */
  limits?: WithdrawalLimits;
}

/**
 * Admin approval (Sprint 31): `pending_review → approved`. Enforces the freeze,
 * per-withdrawal cap, rolling daily cap, and current available balance up front
 * so only legitimately payable requests enter the runner queue. Writes an
 * `admin_audit_log` row. The runner picks `approved` rows up from here.
 */
export async function approveWithdrawal(
  db: LedgerDb,
  input: ApproveWithdrawalInput,
): Promise<WithdrawalRequest> {
  const now = input.now ?? new Date();
  const limits = input.limits ?? WITHDRAWAL_LIMITS;

  if (await isFrozen(db, 'withdrawals')) {
    throw new WithdrawalError('FROZEN', 'Withdrawals are frozen — cannot approve.');
  }

  return db.transaction(async (tx: LedgerDb) => {
    const [row] = await tx
      .select()
      .from(withdrawalRequests)
      .where(eq(withdrawalRequests.id, input.requestId))
      .for('update')
      .limit(1);
    if (!row) throw new WithdrawalError('NOT_FOUND', `withdrawal ${input.requestId} not found`);
    if (row.status !== 'pending_review') {
      throw new WithdrawalError('WRONG_STATUS', `withdrawal is ${row.status}, not pending_review`);
    }

    const amountCheck = checkWithdrawalAmount(row.amountUsdc, limits.maxWithdrawUsdc);
    if (!amountCheck.ok) throw new WithdrawalError(amountCheck.code, amountCheck.message);

    const prior = await withdrawnLast24hUsdc(tx, row.userId, now, row.id);
    const dailyCheck = checkDailyCap(prior, row.amountUsdc, limits.maxDailyUsdc);
    if (!dailyCheck.ok) throw new WithdrawalError(dailyCheck.code, dailyCheck.message);

    const balance = await getBalance(tx, row.userId);
    if (!coversAmount(balance?.availableUsdc ?? '0', row.amountUsdc)) {
      throw new WithdrawalError('INSUFFICIENT_BALANCE', 'Available balance no longer covers this.');
    }

    const [updated] = await tx
      .update(withdrawalRequests)
      .set({
        status: 'approved',
        reviewedByUserId: input.adminUserId,
        reviewedAt: now,
        nextAttemptAt: now,
        updatedAt: now,
      })
      .where(eq(withdrawalRequests.id, input.requestId))
      .returning();

    await logAdminAction(tx, {
      actorUserId: input.adminUserId,
      actorRole: input.actorRole ?? null,
      action: 'withdrawal.approve',
      targetType: 'withdrawal_request',
      targetId: input.requestId,
      metadata: { amountUsdc: row.amountUsdc, destinationWallet: row.destinationWallet },
    });

    return updated!;
  });
}

export interface RejectWithdrawalInput {
  requestId: string;
  adminUserId: string;
  actorRole?: string | null;
  reason?: string;
  now?: Date;
}

/** Admin rejection: `pending_review → rejected`. Records the reason + audit. */
export async function rejectWithdrawal(
  db: LedgerDb,
  input: RejectWithdrawalInput,
): Promise<WithdrawalRequest> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx: LedgerDb) => {
    const [row] = await tx
      .select()
      .from(withdrawalRequests)
      .where(eq(withdrawalRequests.id, input.requestId))
      .for('update')
      .limit(1);
    if (!row) throw new WithdrawalError('NOT_FOUND', `withdrawal ${input.requestId} not found`);
    if (row.status !== 'pending_review') {
      throw new WithdrawalError('WRONG_STATUS', `withdrawal is ${row.status}, not pending_review`);
    }

    const [updated] = await tx
      .update(withdrawalRequests)
      .set({
        status: 'rejected',
        reviewedByUserId: input.adminUserId,
        reviewedAt: now,
        reviewNotes: input.reason ?? null,
        updatedAt: now,
      })
      .where(eq(withdrawalRequests.id, input.requestId))
      .returning();

    await logAdminAction(tx, {
      actorUserId: input.adminUserId,
      actorRole: input.actorRole ?? null,
      action: 'withdrawal.reject',
      targetType: 'withdrawal_request',
      targetId: input.requestId,
      reason: input.reason ?? null,
    });

    return updated!;
  });
}
