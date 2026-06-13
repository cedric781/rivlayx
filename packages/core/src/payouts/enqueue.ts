import { asc, eq } from 'drizzle-orm';
import { bets, settlements } from '@rivlayx/db';
import { PayoutError } from './errors';
import { queuePayoutsForSettlement } from './queue';
import type { LedgerDb } from '../ledger/types';

export type EnqueueOutcome =
  | { settlementId: string; status: 'queued'; inserted: number; existing: number }
  | { settlementId: string; status: 'deferred_no_wallet'; message: string };

/**
 * Enqueue payouts for a single settlement, tolerating a payee without a
 * primary wallet: `NO_PRIMARY_WALLET` is downgraded to a `deferred_no_wallet`
 * outcome (the catch-up sweep retries later) instead of throwing. Other
 * `PayoutError`s (e.g. AMOUNT_EXCEEDS_CAP) still throw — those are real faults.
 */
export async function enqueueForSettlement(
  db: LedgerDb,
  settlementId: string,
): Promise<EnqueueOutcome> {
  try {
    const r = await queuePayoutsForSettlement(db, { settlementId });
    return {
      settlementId,
      status: 'queued',
      inserted: r.inserted.length,
      existing: r.existing.length,
    };
  } catch (err) {
    if (err instanceof PayoutError && err.code === 'NO_PRIMARY_WALLET') {
      return { settlementId, status: 'deferred_no_wallet', message: err.message };
    }
    throw err;
  }
}

export interface EnqueuePendingResult {
  swept: number;
  queued: number;
  deferred: number;
}

/**
 * Enqueue payouts for every SETTLED bet still awaiting payout.
 *
 * `bets.status='SETTLED'` is the natural "not yet fully paid" filter: Sprint 11
 * advances a bet to PAID only once all its payouts succeed, so settled-but-
 * unpaid bets are exactly the ones that may still need rows. This single
 * idempotent sweep covers both the fresh-after-settle and catch-up cases
 * (`queuePayoutsForSettlement` is idempotent on UNIQUE(settlement_id,user_id)).
 * A payee missing a primary wallet is deferred, never fatal.
 */
export async function queuePendingForSettledBets(
  db: LedgerDb,
  options: { limit?: number } = {},
): Promise<EnqueuePendingResult> {
  const limit = options.limit ?? 100;
  const rows = await db
    .select({ settlementId: settlements.id })
    .from(settlements)
    .innerJoin(bets, eq(bets.id, settlements.betId))
    .where(eq(bets.status, 'SETTLED'))
    .orderBy(asc(settlements.settledAt))
    .limit(limit);

  const out: EnqueuePendingResult = { swept: rows.length, queued: 0, deferred: 0 };
  for (const row of rows) {
    const r = await enqueueForSettlement(db, row.settlementId);
    if (r.status === 'queued') out.queued += 1;
    else out.deferred += 1;
  }
  return out;
}
