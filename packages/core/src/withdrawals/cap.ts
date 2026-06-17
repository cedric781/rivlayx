import Decimal from 'decimal.js';

/**
 * Withdrawal safety caps (Sprint 31). Closed-alpha values — tightening or
 * loosening these is an explicit spec change.
 */
export const WITHDRAWAL_LIMITS = {
  /** MAX_WITHDRAW_USDC — per-request hard cap. */
  maxWithdrawUsdc: '25',
  /** Rolling 24h per-user cap across processing + paid withdrawals. */
  maxDailyUsdc: '100',
  /** Retry ceiling before status='failed'. */
  maxAttempts: 5,
  /** Backoff schedule (ms) indexed by completed attempts; last value repeats. */
  retryBackoffsMs: [30_000, 60_000, 180_000, 600_000, 1_800_000] as const,
} as const;

export type WithdrawalCapCode = 'INVALID_INPUT' | 'AMOUNT_EXCEEDS_CAP' | 'DAILY_CAP_EXCEEDED';

export type CapCheck = { ok: true } | { ok: false; code: WithdrawalCapCode; message: string };

/** Per-request amount validation: finite, > 0, ≤ maxWithdrawUsdc. Pure. */
export function checkWithdrawalAmount(
  amountUsdc: string,
  maxUsdc: string = WITHDRAWAL_LIMITS.maxWithdrawUsdc,
): CapCheck {
  const amt = new Decimal(amountUsdc);
  if (!amt.isFinite() || amt.lte(0)) {
    return { ok: false, code: 'INVALID_INPUT', message: `amount must be > 0 (got ${amountUsdc})` };
  }
  if (amt.gt(maxUsdc)) {
    return {
      ok: false,
      code: 'AMOUNT_EXCEEDS_CAP',
      message: `amount ${amountUsdc} exceeds per-withdrawal cap ${maxUsdc} USDC`,
    };
  }
  return { ok: true };
}

/**
 * Rolling daily cap check. Pure: caller supplies the already-summed total of
 * the user's withdrawals in the trailing window. `priorTotalUsdc + amount` must
 * not exceed `maxDailyUsdc`.
 */
export function checkDailyCap(
  priorTotalUsdc: string,
  amountUsdc: string,
  maxDailyUsdc: string = WITHDRAWAL_LIMITS.maxDailyUsdc,
): CapCheck {
  const projected = new Decimal(priorTotalUsdc).plus(amountUsdc);
  if (projected.gt(maxDailyUsdc)) {
    return {
      ok: false,
      code: 'DAILY_CAP_EXCEEDED',
      message: `withdrawal would exceed the ${maxDailyUsdc} USDC daily cap (already ${priorTotalUsdc})`,
    };
  }
  return { ok: true };
}

/** Next backoff (ms) for a given completed attempt count (1-based). */
export function nextWithdrawalBackoffMs(attemptsCompleted: number): number {
  const table = WITHDRAWAL_LIMITS.retryBackoffsMs;
  if (attemptsCompleted <= 0) return table[0]!;
  return table[Math.min(attemptsCompleted - 1, table.length - 1)]!;
}
