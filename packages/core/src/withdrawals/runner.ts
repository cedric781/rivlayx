import { randomUUID } from 'node:crypto';
import { and, asc, eq, lte } from 'drizzle-orm';
import { withdrawalRequests, type WithdrawalRequest } from '@rivlayx/db';
import { TransferPermanentError, TransferRetryableError } from '../payouts/errors';
import type { SolanaTransferProvider } from '../payouts/types';
import { postLedgerTxnIn } from '../ledger/post';
import { getBalance } from '../ledger/balances';
import { isFrozen } from '../ledger/freeze';
import { logAdminAction } from '../admin/audit-log';
import type { LedgerDb } from '../ledger/types';
import { checkDailyCap, checkWithdrawalAmount, nextWithdrawalBackoffMs } from './cap';
import { withdrawnLast24hUsdc } from './query';

export interface ProcessWithdrawalQueueOptions {
  limit?: number;
  now?: Date;
}
export interface ProcessWithdrawalQueueResult {
  candidatesSeen: number;
  paid: number;
  failedRetryable: number;
  failedPermanent: number;
  skippedFrozen: boolean;
}
export type ProcessOneWithdrawalResult =
  | { kind: 'paid'; request: WithdrawalRequest }
  | { kind: 'retryable_failure'; request: WithdrawalRequest; message: string }
  | { kind: 'permanent_failure'; request: WithdrawalRequest; message: string }
  | { kind: 'skipped'; reason: string };

/**
 * Drain the withdrawal queue: `approved` rows with `next_attempt_at ≤ now`,
 * oldest first. Hard-skipped while the `withdrawals` (or `all`) freeze is on.
 * Mirrors the payout runner and reuses its transfer providers + ledger posting.
 */
export async function processWithdrawalQueue(
  db: LedgerDb,
  provider: SolanaTransferProvider,
  options: ProcessWithdrawalQueueOptions = {},
): Promise<ProcessWithdrawalQueueResult> {
  if (await isFrozen(db, 'withdrawals')) {
    return { candidatesSeen: 0, paid: 0, failedRetryable: 0, failedPermanent: 0, skippedFrozen: true };
  }
  const now = options.now ?? new Date();
  const limit = options.limit ?? 50;

  const candidates = await db
    .select()
    .from(withdrawalRequests)
    .where(and(eq(withdrawalRequests.status, 'approved'), lte(withdrawalRequests.nextAttemptAt, now)))
    .orderBy(asc(withdrawalRequests.nextAttemptAt))
    .limit(limit);

  let paid = 0;
  let failedRetryable = 0;
  let failedPermanent = 0;
  for (const c of candidates) {
    const r = await processOneWithdrawal(db, provider, c.id, { now });
    if (r.kind === 'paid') paid += 1;
    else if (r.kind === 'retryable_failure') failedRetryable += 1;
    else if (r.kind === 'permanent_failure') failedPermanent += 1;
  }
  return { candidatesSeen: candidates.length, paid, failedRetryable, failedPermanent, skippedFrozen: false };
}

/**
 * Process one withdrawal end-to-end. Double-payout is impossible because only
 * `approved` rows are claimable, the claim is FOR UPDATE + flips status to
 * `processing` atomically, the provider is idempotent on the row id, and the
 * ledger post is idempotent on `requestId = row.id`.
 */
export async function processOneWithdrawal(
  db: LedgerDb,
  provider: SolanaTransferProvider,
  requestId: string,
  options: { now?: Date } = {},
): Promise<ProcessOneWithdrawalResult> {
  const now = options.now ?? new Date();

  // ── 1. Claim: lock, re-check caps + balance, flip to 'processing' ──
  const claimed = await db.transaction(async (tx: LedgerDb) => {
    const [row] = await tx
      .select()
      .from(withdrawalRequests)
      .where(eq(withdrawalRequests.id, requestId))
      .for('update')
      .limit(1);
    if (!row) return null;
    if (row.status !== 'approved') return null;
    if (row.nextAttemptAt.getTime() > now.getTime()) return null;

    const amountCheck = checkWithdrawalAmount(row.amountUsdc);
    if (!amountCheck.ok) {
      await markFailed(tx, row, amountCheck.message, now);
      return { kind: 'failed' as const, message: amountCheck.message };
    }
    const prior = await withdrawnLast24hUsdc(tx, row.userId, now, row.id);
    const dailyCheck = checkDailyCap(prior, row.amountUsdc);
    if (!dailyCheck.ok) {
      await markFailed(tx, row, dailyCheck.message, now);
      return { kind: 'failed' as const, message: dailyCheck.message };
    }
    const balance = await getBalance(tx, row.userId);
    if (Number(balance?.availableUsdc ?? '0') < Number(row.amountUsdc)) {
      const msg = 'available balance no longer covers this withdrawal';
      await markFailed(tx, row, msg, now);
      return { kind: 'failed' as const, message: msg };
    }

    await tx
      .update(withdrawalRequests)
      .set({ status: 'processing', attempts: row.attempts + 1, processingAt: now, updatedAt: now })
      .where(eq(withdrawalRequests.id, requestId));
    return { kind: 'claimed' as const, row };
  });

  if (!claimed) return { kind: 'skipped', reason: 'not eligible' };
  if (claimed.kind === 'failed') {
    const [u] = await db.select().from(withdrawalRequests).where(eq(withdrawalRequests.id, requestId)).limit(1);
    return { kind: 'permanent_failure', request: u!, message: claimed.message };
  }

  const row = claimed.row;
  const attemptNumber = row.attempts + 1;

  // ── 2. Transfer (outside any DB transaction) ──
  let providerResult: { txSignature: string } | null = null;
  let providerError: { kind: 'retryable' | 'permanent'; message: string } | null = null;
  try {
    providerResult = await provider.buildAndSubmitTransfer({
      reference: row.id, // idempotency key — provider must replay, not double-spend
      toWallet: row.destinationWallet,
      amountUsdc: row.amountUsdc,
      betId: row.id, // no bet for a withdrawal; row id doubles as the trace ref
    });
  } catch (err) {
    if (err instanceof TransferRetryableError) providerError = { kind: 'retryable', message: err.message };
    else if (err instanceof TransferPermanentError) providerError = { kind: 'permanent', message: err.message };
    else providerError = { kind: 'retryable', message: err instanceof Error ? err.message : String(err) };
  }

  // ── 3. Apply result atomically ──
  return db.transaction(async (tx: LedgerDb) => {
    if (providerResult) {
      // Idempotent on requestId=row.id — a replay returns the existing txn.
      const ledger = await postLedgerTxnIn(tx, {
        txnId: randomUUID(),
        requestId: row.id,
        createdBy: 'withdrawal-runner:paid',
        entries: [
          {
            accountType: 'user_available',
            accountRef: row.userId,
            direction: 'debit',
            amountUsdc: row.amountUsdc,
            reason: 'withdrawal_complete',
            relatedTxSignature: providerResult.txSignature,
          },
          {
            accountType: 'deposit_holding',
            accountRef: 'vault',
            direction: 'credit',
            amountUsdc: row.amountUsdc,
            reason: 'withdrawal_complete',
            relatedTxSignature: providerResult.txSignature,
          },
        ],
      });

      const [updated] = await tx
        .update(withdrawalRequests)
        .set({
          status: 'paid',
          txSignature: providerResult.txSignature,
          ledgerTxnId: ledger.txnId,
          paidAt: now,
          lastError: null,
          updatedAt: now,
        })
        .where(eq(withdrawalRequests.id, requestId))
        .returning();

      if (row.reviewedByUserId) {
        await logAdminAction(tx, {
          actorUserId: row.reviewedByUserId,
          actorRole: 'system',
          action: 'withdrawal.paid',
          targetType: 'withdrawal_request',
          targetId: row.id,
          metadata: {
            amountUsdc: row.amountUsdc,
            txSignature: providerResult.txSignature,
            ledgerTxnId: ledger.txnId,
            attempt: attemptNumber,
          },
        });
      }
      return { kind: 'paid', request: updated! };
    }

    const err = providerError!;
    const permanent = err.kind === 'permanent';
    const exhausted = attemptNumber >= row.maxAttempts;

    if (permanent || exhausted) {
      const [updated] = await tx
        .update(withdrawalRequests)
        .set({
          status: 'failed',
          lastError: permanent ? err.message : `retries exhausted (${attemptNumber}/${row.maxAttempts}): ${err.message}`,
          failedAt: now,
          updatedAt: now,
        })
        .where(eq(withdrawalRequests.id, requestId))
        .returning();
      if (row.reviewedByUserId) {
        await logAdminAction(tx, {
          actorUserId: row.reviewedByUserId,
          actorRole: 'system',
          action: 'withdrawal.failed',
          targetType: 'withdrawal_request',
          targetId: row.id,
          reason: err.message,
          metadata: { attempt: attemptNumber, permanent },
        });
      }
      return { kind: 'permanent_failure', request: updated!, message: err.message };
    }

    // retryable, attempts remain → back to 'approved' with backoff
    const nextAttemptAt = new Date(now.getTime() + nextWithdrawalBackoffMs(attemptNumber));
    const [updated] = await tx
      .update(withdrawalRequests)
      .set({ status: 'approved', lastError: err.message, nextAttemptAt, updatedAt: now })
      .where(eq(withdrawalRequests.id, requestId))
      .returning();
    return { kind: 'retryable_failure', request: updated!, message: err.message };
  });
}

/** Mark a claimed row permanently failed (cap/balance violation at process time). */
async function markFailed(
  tx: LedgerDb,
  row: WithdrawalRequest,
  message: string,
  now: Date,
): Promise<void> {
  await tx
    .update(withdrawalRequests)
    .set({
      status: 'failed',
      attempts: row.attempts + 1,
      lastError: message,
      failedAt: now,
      updatedAt: now,
    })
    .where(eq(withdrawalRequests.id, row.id));
}
