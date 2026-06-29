import { asc, eq } from 'drizzle-orm';
import { bets } from '@rivlayx/db';
import { isFrozen } from '../ledger/freeze';
import { BetError } from './errors';
import { settleBet } from './settle';
import type { BetDb } from './types';

export interface SettlementCycleOptions {
  /** Max bets to settle this run. Default 100. */
  limit?: number;
}

export interface SettlementCycleResult {
  /** betIds newly moved RESOLVED → SETTLED this run. */
  settled: string[];
  /** betIds that were already settled (idempotent no-op). */
  alreadySettled: string[];
  /** Per-bet failures; collected, never abort the batch. */
  errors: Array<{ betId: string; code: string; message: string }>;
  /**
   * Set to `'frozen'` when the whole cycle was hard-skipped by the kill-switch
   * (the `settlements` component, or the global `all` freeze). Absent on a normal
   * run, so unfrozen behaviour is unchanged.
   */
  skipped?: 'frozen';
}

/**
 * Settle every RESOLVED bet — Sprint 12a settlement cron. Thin orchestration
 * over `settleBet`; no new settlement logic. Each bet settles in its own
 * transaction (settleBet opens one), so one failing bet never rolls back the
 * others — failures are collected and returned. Idempotent: `settleBet`
 * early-returns on already-settled bets.
 *
 * Deliberately does NOT enqueue payouts — that's a separate sweep
 * (`queuePendingForSettledBets`) so a winner missing a wallet can never roll
 * back a valid settlement.
 */
export async function runSettlementCycle(
  db: BetDb,
  options: SettlementCycleOptions = {},
): Promise<SettlementCycleResult> {
  // Kill-switch: a `settlements` (or global `all`) freeze hard-skips the entire
  // cycle BEFORE any bet is selected or `settleBet` is called — so no bet is
  // advanced and no ledger entry is posted while settlement is frozen. One check
  // covers both components: `isFrozen('settlements')` returns true when `all` is
  // frozen. Mirrors the withdrawals runner's top-level freeze guard.
  if (await isFrozen(db, 'settlements')) {
    return { settled: [], alreadySettled: [], errors: [], skipped: 'frozen' };
  }

  const limit = options.limit ?? 100;
  const rows = await db
    .select({ id: bets.id })
    .from(bets)
    .where(eq(bets.status, 'RESOLVED'))
    .orderBy(asc(bets.resolvedAt))
    .limit(limit);

  const result: SettlementCycleResult = { settled: [], alreadySettled: [], errors: [] };
  for (const row of rows) {
    try {
      const r = await settleBet(db, { betId: row.id });
      if (r.kind === 'settled') result.settled.push(row.id);
      else result.alreadySettled.push(row.id);
    } catch (err) {
      if (err instanceof BetError) {
        result.errors.push({ betId: row.id, code: err.code, message: err.message });
      } else {
        result.errors.push({
          betId: row.id,
          code: 'UNKNOWN',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  return result;
}
