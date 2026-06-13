import { randomUUID } from 'node:crypto';
import { and, asc, eq, lte, sql } from 'drizzle-orm';
import {
  bets,
  betEvents,
  payouts,
  payoutAttempts,
  type Payout,
  type PayoutAttemptStatus,
} from '@rivlayx/db';
import { TransferPermanentError, TransferRetryableError } from './errors';
import { nextBackoffMs, validatePayoutAmount, PAYOUT_LIMITS } from './cap';
import { postLedgerTxnIn } from '../ledger/post';
import { isFrozen } from '../ledger/freeze';
import { recordBetTransition } from '../bets/audit';
import type { LedgerDb } from '../ledger/types';
import type { SolanaTransferProvider } from './types';

export interface ProcessPayoutQueueOptions {
  /** Optional cap on number of payouts attempted per run. Default 50. */
  limit?: number;
  /** Override "now" for deterministic tests. */
  now?: Date;
}

export interface ProcessPayoutQueueResult {
  candidatesSeen: number;
  succeeded: number;
  failedRetryable: number;
  failedPermanent: number;
  skippedFrozen: boolean;
}

export type ProcessOnePayoutResult =
  | { kind: 'succeeded'; payout: Payout }
  | { kind: 'retryable_failure'; payout: Payout; message: string }
  | { kind: 'permanent_failure'; payout: Payout; message: string }
  | { kind: 'skipped'; reason: string };

/**
 * Drain the payout queue. Picks rows where status='pending' AND
 * next_attempt_at ≤ now, ordered by next_attempt_at ASC. Each row processed
 * through `processOnePayout`. Hard-skipped when withdrawals/all freeze is
 * active.
 */
export async function processPayoutQueue(
  db: LedgerDb,
  provider: SolanaTransferProvider,
  options: ProcessPayoutQueueOptions = {},
): Promise<ProcessPayoutQueueResult> {
  if (await isFrozen(db, 'withdrawals')) {
    return {
      candidatesSeen: 0,
      succeeded: 0,
      failedRetryable: 0,
      failedPermanent: 0,
      skippedFrozen: true,
    };
  }

  const now = options.now ?? new Date();
  const limit = options.limit ?? 50;

  const candidates: Payout[] = await db
    .select()
    .from(payouts)
    .where(and(eq(payouts.status, 'pending'), lte(payouts.nextAttemptAt, now)))
    .orderBy(asc(payouts.nextAttemptAt))
    .limit(limit);

  let succeeded = 0;
  let failedRetryable = 0;
  let failedPermanent = 0;

  for (const p of candidates) {
    const r = await processOnePayout(db, provider, p.id, { now });
    if (r.kind === 'succeeded') succeeded += 1;
    else if (r.kind === 'retryable_failure') failedRetryable += 1;
    else if (r.kind === 'permanent_failure') failedPermanent += 1;
  }

  return {
    candidatesSeen: candidates.length,
    succeeded,
    failedRetryable,
    failedPermanent,
    skippedFrozen: false,
  };
}

/**
 * Process a single payout end-to-end:
 *   1. FOR UPDATE lock; bail if status is not 'pending'.
 *   2. Bump status to 'processing', persist attempt counter snapshot.
 *   3. Call `provider.buildAndSubmitTransfer`.
 *   4a. Success → post ledger (debit user_available, credit deposit_holding),
 *       status='succeeded', tx_signature, succeeded_at; log attempt;
 *       maybe advance bet to PAID.
 *   4b. Retryable → status='pending', attempts++, next_attempt_at=now+backoff
 *       (or status='failed' if attempts ≥ maxAttempts); log attempt.
 *   4c. Permanent → status='failed', failed_at, last_error; log attempt.
 *
 * Everything inside a single Drizzle transaction so ledger + payout +
 * attempt log + bet transition move atomically.
 */
export async function processOnePayout(
  db: LedgerDb,
  provider: SolanaTransferProvider,
  payoutId: string,
  options: { now?: Date } = {},
): Promise<ProcessOnePayoutResult> {
  // First we move the row into 'processing' inside its own transaction.
  // Provider call happens OUTSIDE any transaction (it talks to Solana).
  // Then the result is applied in a follow-up transaction.
  //
  // Splitting it this way keeps the DB transaction short and avoids holding
  // FOR UPDATE locks across network calls.

  const now = options.now ?? new Date();

  const claimed = await db.transaction(async (tx: LedgerDb) => {
    const [row] = await tx
      .select()
      .from(payouts)
      .where(eq(payouts.id, payoutId))
      .for('update')
      .limit(1);
    if (!row) return null;
    if (row.status !== 'pending') return null;
    if (row.nextAttemptAt.getTime() > now.getTime()) return null;

    // Defensive cap check at process-time too — a rogue insertion can't
    // sneak past the queue layer.
    try {
      validatePayoutAmount(row.amountUsdc);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await markFailedPermanent(tx, row, message, now);
      return { kind: 'permanent_failure' as const, message };
    }

    await tx
      .update(payouts)
      .set({
        status: 'processing',
        attempts: row.attempts + 1,
        updatedAt: now,
      })
      .where(eq(payouts.id, payoutId));

    return { kind: 'claimed' as const, row };
  });

  if (!claimed) {
    return { kind: 'skipped', reason: 'not eligible' };
  }
  if (claimed.kind === 'permanent_failure') {
    const [updated] = await db.select().from(payouts).where(eq(payouts.id, payoutId)).limit(1);
    return { kind: 'permanent_failure', payout: updated!, message: claimed.message };
  }

  const payoutRow = claimed.row;
  const attemptNumber = payoutRow.attempts + 1; // attempts was bumped above

  let providerResult: { txSignature: string } | null = null;
  let providerError: { kind: 'retryable' | 'permanent'; message: string } | null = null;

  try {
    providerResult = await provider.buildAndSubmitTransfer({
      reference: payoutRow.id,
      toWallet: payoutRow.destinationWallet,
      amountUsdc: payoutRow.amountUsdc,
      betId: payoutRow.betId,
    });
  } catch (err) {
    if (err instanceof TransferRetryableError) {
      providerError = { kind: 'retryable', message: err.message };
    } else if (err instanceof TransferPermanentError) {
      providerError = { kind: 'permanent', message: err.message };
    } else {
      // Unknown — treat as retryable so admin can inspect.
      providerError = {
        kind: 'retryable',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return db.transaction(async (tx: LedgerDb) => {
    if (providerResult) {
      // Idempotent on the payout's own id as requestId (same pattern as
      // deposit-credit): a re-driven apply (e.g. a future stuck-'processing'
      // reaper) replays the existing ledger txn instead of double-posting.
      const ledgerResult = await postLedgerTxnIn(tx, {
        txnId: randomUUID(),
        requestId: payoutRow.id,
        createdBy: 'payout-runner:succeeded',
        entries: [
          {
            accountType: 'user_available',
            accountRef: payoutRow.userId,
            direction: 'debit',
            amountUsdc: payoutRow.amountUsdc,
            reason: 'withdrawal_complete',
            betId: payoutRow.betId,
            relatedTxSignature: providerResult.txSignature,
          },
          {
            // On-chain payout drains the vault asset — the exact inverse of the
            // deposit posting (debit deposit_holding / credit user_available).
            // Crediting treasury here would overstate equity and break vault
            // reconciliation, since deposit_holding would never reflect the
            // outflow.
            accountType: 'deposit_holding',
            accountRef: 'vault',
            direction: 'credit',
            amountUsdc: payoutRow.amountUsdc,
            reason: 'withdrawal_complete',
            betId: payoutRow.betId,
            relatedTxSignature: providerResult.txSignature,
          },
        ],
      });

      await tx
        .update(payouts)
        .set({
          status: 'succeeded',
          txSignature: providerResult.txSignature,
          ledgerTxnId: ledgerResult.txnId,
          succeededAt: now,
          lastError: null,
          updatedAt: now,
        })
        .where(eq(payouts.id, payoutId));

      await tx.insert(payoutAttempts).values({
        payoutId: payoutRow.id,
        attemptNumber,
        status: 'succeeded' satisfies PayoutAttemptStatus,
        txSignature: providerResult.txSignature,
      });

      await maybeAdvanceBetToPaid(tx, payoutRow.betId, now);

      const [updated] = await tx.select().from(payouts).where(eq(payouts.id, payoutId)).limit(1);
      return { kind: 'succeeded', payout: updated! };
    }

    // providerError is set
    const err = providerError!;

    await tx.insert(payoutAttempts).values({
      payoutId: payoutRow.id,
      attemptNumber,
      status:
        err.kind === 'retryable'
          ? ('failed_retryable' satisfies PayoutAttemptStatus)
          : ('failed_permanent' satisfies PayoutAttemptStatus),
      errorMessage: err.message,
    });

    if (err.kind === 'permanent') {
      await tx
        .update(payouts)
        .set({
          status: 'failed',
          lastError: err.message,
          failedAt: now,
          updatedAt: now,
        })
        .where(eq(payouts.id, payoutId));
      const [updated] = await tx.select().from(payouts).where(eq(payouts.id, payoutId)).limit(1);
      return { kind: 'permanent_failure', payout: updated!, message: err.message };
    }

    // retryable
    const exhausted = attemptNumber >= payoutRow.maxAttempts;
    if (exhausted) {
      await tx
        .update(payouts)
        .set({
          status: 'failed',
          lastError: `retries exhausted (${attemptNumber}/${payoutRow.maxAttempts}): ${err.message}`,
          failedAt: now,
          updatedAt: now,
        })
        .where(eq(payouts.id, payoutId));
    } else {
      const backoff = nextBackoffMs(attemptNumber);
      const nextAttemptAt = new Date(now.getTime() + backoff);
      await tx
        .update(payouts)
        .set({
          status: 'pending',
          lastError: err.message,
          nextAttemptAt,
          updatedAt: now,
        })
        .where(eq(payouts.id, payoutId));
    }

    const [updated] = await tx.select().from(payouts).where(eq(payouts.id, payoutId)).limit(1);
    return { kind: 'retryable_failure', payout: updated!, message: err.message };
  });
}

async function markFailedPermanent(
  tx: LedgerDb,
  row: Payout,
  message: string,
  now: Date,
): Promise<void> {
  await tx
    .update(payouts)
    .set({
      status: 'failed',
      attempts: row.attempts + 1,
      lastError: message,
      failedAt: now,
      updatedAt: now,
    })
    .where(eq(payouts.id, row.id));
  await tx.insert(payoutAttempts).values({
    payoutId: row.id,
    attemptNumber: row.attempts + 1,
    status: 'failed_permanent' satisfies PayoutAttemptStatus,
    errorMessage: message,
  });
}

/**
 * If every payout for this bet is now `succeeded`, advance the bet
 * SETTLED → PAID with a `bet_paid` event + audit transition.
 */
async function maybeAdvanceBetToPaid(tx: LedgerDb, betId: string, now: Date): Promise<void> {
  const [bet] = await tx.select().from(bets).where(eq(bets.id, betId)).limit(1);
  if (!bet) return;
  if (bet.status !== 'SETTLED') return;

  const open: Array<{ status: string }> = await tx
    .select({ status: payouts.status })
    .from(payouts)
    .where(eq(payouts.betId, betId));
  const allSucceeded = open.length > 0 && open.every((p) => p.status === 'succeeded');
  if (!allSucceeded) return;

  const updated = await tx
    .update(bets)
    .set({
      status: 'PAID',
      paidAt: now,
      version: sql`${bets.version} + 1`,
      updatedAt: now,
    })
    .where(and(eq(bets.id, betId), eq(bets.status, 'SETTLED')))
    .returning();
  if (updated.length === 0) return; // concurrent

  await recordBetTransition(tx, {
    betId,
    fromStatus: 'SETTLED',
    toStatus: 'PAID',
    eventType: 'bet_paid',
    actorUserId: null,
    actorType: 'system',
    reason: 'all payouts succeeded',
  });

  // Drop a granular event for the activity feed.
  await tx.insert(betEvents).values({
    betId,
    eventType: 'bet_paid',
    actorUserId: null,
    payload: { paidAt: now.toISOString() },
  });
}

export const PAYOUT_RUNNER_VERSION = PAYOUT_LIMITS.maxAttempts;
