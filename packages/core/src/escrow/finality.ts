import { eq } from 'drizzle-orm';
import { onchainTransfers } from '@rivlayx/db';
import type { LedgerDb } from '../ledger/types';
import { OnchainTransferError, markFailed, markFinalized } from './transfers';

/**
 * Submit → finalized confirmation flow (Phase 6 prerequisite). A `submitted`
 * transfer carries a `tx_signature` but no proof the chain accepted it; this
 * service-layer pass resolves each submitted signature's on-chain finality and
 * advances the record's state machine accordingly — so a transfer never sits in
 * `submitted` forever.
 *
 * It is the ONLY missing piece between `markSubmitted` and `markFinalized`. It
 * reuses the existing guarded transitions (`markFinalized`, `markFailed`) and
 * writes NOTHING else: no ledger, no balances, no freeze, no cron. The chain
 * lookup is injected (`FinalityChecker`) — no RPC client is hardcoded — so it is
 * unit-testable with a fake and provider-neutral.
 *
 * Idempotent + safe to re-run: it only ever selects `submitted` rows, so an
 * already-finalized / already-failed transfer is never re-touched. A concurrent
 * run that already advanced a row yields `INVALID_TRANSITION`, which is treated
 * as "already handled" — never a double transition. A checker error leaves the
 * transfer `submitted` for a later run (retryable).
 */

export type FinalityStatus = 'finalized' | 'failed' | 'pending';

export interface FinalityChecker {
  /** Resolve a submitted transfer signature's on-chain finality. */
  check(txSignature: string): Promise<FinalityStatus>;
}

export interface ReconcileFinalityOptions {
  /** Max submitted transfers to resolve this pass. Defaults to 100. */
  limit?: number;
  /** Transition timestamp. Defaults to now. */
  now?: Date;
}

export interface FinalityResult {
  /** Submitted transfers whose signature was actually checked on-chain. */
  checked: number;
  finalized: number;
  failed: number;
  /** Checked but still unconfirmed → left `submitted`. */
  stillPending: number;
  /** Submitted with no `tx_signature` → nothing to confirm, left `submitted`. */
  skipped: number;
  /** Checker/RPC threw → left `submitted` for a later run (retryable). */
  errored: number;
}

interface SubmittedRow {
  id: string;
  txSignature: string | null;
}

export async function reconcileTransferFinality(
  db: LedgerDb,
  checker: FinalityChecker,
  options: ReconcileFinalityOptions = {},
): Promise<FinalityResult> {
  const limit = options.limit ?? 100;
  const now = options.now ?? new Date();

  const rows = (await db
    .select({ id: onchainTransfers.id, txSignature: onchainTransfers.txSignature })
    .from(onchainTransfers)
    .where(eq(onchainTransfers.status, 'submitted'))
    .limit(limit)) as SubmittedRow[];

  const result: FinalityResult = {
    checked: 0,
    finalized: 0,
    failed: 0,
    stillPending: 0,
    skipped: 0,
    errored: 0,
  };

  for (const row of rows) {
    // 1. A submitted transfer without a signature has nothing to confirm.
    if (!row.txSignature) {
      result.skipped += 1;
      continue;
    }

    // 2. Injected chain lookup — a transient failure leaves it submitted.
    let status: FinalityStatus;
    try {
      status = await checker.check(row.txSignature);
    } catch {
      result.errored += 1;
      continue;
    }
    result.checked += 1;

    if (status === 'pending') {
      result.stillPending += 1;
      continue;
    }

    // 3. Apply the outcome via the existing guarded transitions. A concurrent
    // run may already have advanced the row → INVALID_TRANSITION is benign.
    try {
      if (status === 'finalized') {
        await markFinalized(db, row.id, { now });
        result.finalized += 1;
      } else {
        await markFailed(db, row.id, 'on-chain confirmation: transaction failed', now);
        result.failed += 1;
      }
    } catch (err) {
      if (err instanceof OnchainTransferError && err.code === 'INVALID_TRANSITION') {
        continue;
      }
      throw err;
    }
  }

  return result;
}
