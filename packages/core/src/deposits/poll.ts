import { asc, eq } from 'drizzle-orm';
import { deposits } from '@rivlayx/db';
import type { IHeliusRpc } from '@rivlayx/helius';
import type { LedgerDb } from '../ledger/types';
import { confirmDeposit } from './confirm';
import { creditDeposit } from './credit';

export interface ProcessPendingDepositsOptions {
  /** Max deposits to process per run. Default 50 (mirrors the withdrawal runner). */
  limit?: number;
}

export interface ProcessPendingDepositsResult {
  candidatesSeen: number;
  credited: number;
  stillPending: number;
  rejected: number;
  /** RPC failures (timeout/outage) — deposit left pending for the next tick. */
  errored: number;
}

/**
 * Deposit poller (C6B). Walks `pending` deposits oldest-first and drives the
 * EXISTING `confirmDeposit → creditDeposit` pipeline against the injected
 * `IHeliusRpc`. This is the only production path that credits a deposit, and it
 * credits ONLY at real `finalized` finality (enforced in `confirmDeposit`).
 *
 *   - finalized          → confirmed → credited
 *   - confirmed/processed → still pending (rollback-able, never credited)
 *   - unknown signature   → still pending (RPC has no record yet)
 *   - tx error on chain   → rejected (no credit)
 *   - RPC throw/timeout   → left pending, counted as `errored`, retried next tick
 *
 * Idempotent: `confirmDeposit` only acts on `status='pending'` and
 * `creditDeposit` is idempotent on `deposit.id`, so overlapping runs or a
 * webhook/poller race can never double-credit. No new ledger logic.
 */
export async function processPendingDeposits(
  db: LedgerDb,
  rpc: IHeliusRpc,
  options: ProcessPendingDepositsOptions = {},
): Promise<ProcessPendingDepositsResult> {
  const limit = options.limit ?? 50;

  const candidates = await db
    .select({ id: deposits.id })
    .from(deposits)
    .where(eq(deposits.status, 'pending'))
    .orderBy(asc(deposits.detectedAt))
    .limit(limit);

  let credited = 0;
  let stillPending = 0;
  let rejected = 0;
  let errored = 0;

  for (const c of candidates) {
    let confirm;
    try {
      confirm = await confirmDeposit(db, rpc, c.id);
    } catch {
      // RPC failure (timeout/outage) — never credit on uncertainty. Leave the
      // deposit pending; the next cron tick retries.
      errored += 1;
      continue;
    }

    if (confirm.kind === 'confirmed') {
      const credit = await creditDeposit(db, c.id);
      if (credit.kind === 'credited' || credit.kind === 'already_credited') {
        credited += 1;
      } else {
        // not_found / wrong_status — raced to a non-creditable state; no-op.
        errored += 1;
      }
    } else if (confirm.kind === 'still_pending') {
      stillPending += 1;
    } else if (confirm.kind === 'tx_failed') {
      rejected += 1;
    }
    // not_found / wrong_status: the row left 'pending' between select and
    // re-check (e.g. credited by a racing worker) — skip silently.
  }

  return { candidatesSeen: candidates.length, credited, stillPending, rejected, errored };
}
