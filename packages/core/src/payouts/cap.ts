import Decimal from 'decimal.js';
import { SAFETY_BRAKE_DEFAULTS } from '@rivlayx/shared';
import { PayoutError } from './errors';

/**
 * Largest legal payout = the full pot of a max-stake bet = 2 × MAX_BET_USDC.
 * DERIVED from the same safety brake the bet-create path enforces so the two
 * caps can never silently drift apart — if MAX_BET_USDC is raised, this cap
 * tracks it instead of stranding legitimate winners behind AMOUNT_EXCEEDS_CAP.
 * (A draw refunds a single stake, strictly smaller, so this bound covers both
 * settlement kinds.) Callers with an env-resolved cap may override per-call.
 */
export const MAX_PAYOUT_USDC = String(2 * SAFETY_BRAKE_DEFAULTS.MAX_BET_USDC);

/**
 * Hard safety caps for the payout engine. Tightening / loosening the cap
 * requires an explicit config + spec change to MAX_BET_USDC.
 */
export const PAYOUT_LIMITS = {
  /** Per-payout cap; rejects oversize at queue + process time. */
  maxPayoutUsdc: MAX_PAYOUT_USDC,
  /** Hard ceiling on retries before status='failed' (also stored per-row). */
  maxAttempts: 5,
  /**
   * Backoff schedule indexed by attempt number (0-based). After attempt N
   * fails-retryable, next_attempt_at = now + retryBackoffsMs[N].
   * The last value applies to all attempts past the table.
   */
  retryBackoffsMs: [30_000, 60_000, 180_000, 600_000, 1_800_000] as const,
} as const;

export function validatePayoutAmount(
  amountUsdc: string,
  maxUsdc: string = PAYOUT_LIMITS.maxPayoutUsdc,
): void {
  const amt = new Decimal(amountUsdc);
  if (!amt.isFinite() || amt.lte(0)) {
    throw new PayoutError('INVALID_INPUT', `payout amount must be > 0 (got ${amountUsdc})`);
  }
  if (amt.gt(maxUsdc)) {
    throw new PayoutError('AMOUNT_EXCEEDS_CAP', `payout amount ${amountUsdc} exceeds cap ${maxUsdc}`);
  }
}

/** Pick the next backoff value for a given attempt count (1-based). */
export function nextBackoffMs(attemptsCompleted: number): number {
  const table = PAYOUT_LIMITS.retryBackoffsMs;
  if (attemptsCompleted <= 0) return table[0]!;
  const idx = Math.min(attemptsCompleted - 1, table.length - 1);
  return table[idx]!;
}
