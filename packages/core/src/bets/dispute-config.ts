import Decimal from 'decimal.js';

/**
 * Dispute deposit pricing — opener must lock this amount to open a dispute.
 *   - `depositPct` percentage of the bet pot (both stakes combined)
 *   - clamped to `[minDepositUsdc, maxDepositUsdc]`
 *
 * Uphold → deposit refunded. Reject → deposit forfeit to platform.
 *
 * Per Fase 1 blueprint defaults: 15% of pot, floor $5, cap $500.
 */
export interface DisputeConfig {
  /** Decimal string in [0, 1], e.g. '0.15' for 15%. */
  depositPct: string;
  /** Lower bound (USDC). */
  minDepositUsdc: string;
  /** Upper bound (USDC). */
  maxDepositUsdc: string;
}

export const DISPUTE_DEFAULTS: DisputeConfig = {
  depositPct: '0.15',
  minDepositUsdc: '5',
  maxDepositUsdc: '500',
};

/**
 * Given the bet pot (both stakes), return the required dispute deposit clamped
 * to the config bounds. Always returns a 6-decimal USDC string.
 */
export function computeDisputeDeposit(
  potUsdc: string,
  config: DisputeConfig = DISPUTE_DEFAULTS,
): string {
  const pot = new Decimal(potUsdc);
  if (!pot.isFinite() || pot.lte(0)) {
    throw new Error('pot must be > 0');
  }
  const pct = new Decimal(config.depositPct);
  if (pct.lt(0) || pct.gt(1)) {
    throw new Error('depositPct must be in [0, 1]');
  }
  const min = new Decimal(config.minDepositUsdc);
  const max = new Decimal(config.maxDepositUsdc);
  if (min.gt(max)) {
    throw new Error('minDepositUsdc must be <= maxDepositUsdc');
  }

  const raw = pot.times(pct);
  let result = raw;
  if (result.lt(min)) result = min;
  if (result.gt(max)) result = max;
  return result.toFixed(6);
}

/** 24h dispute window after a result is proposed. */
export const DISPUTE_WINDOW_MS = 24 * 60 * 60 * 1000;
