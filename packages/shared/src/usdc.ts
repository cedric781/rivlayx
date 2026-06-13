import Decimal from 'decimal.js';
import { USDC_DECIMALS } from './constants';

const SCALE = new Decimal(10).pow(USDC_DECIMALS);

/**
 * Convert a human-readable USDC amount (e.g. "12.34" or 12.34) to raw SPL token
 * units as a bigint. Throws if the amount has more than USDC_DECIMALS decimal
 * places — silently truncating would corrupt the ledger.
 */
export function toRawUnits(amount: string | number): bigint {
  const scaled = new Decimal(amount).mul(SCALE);
  if (!scaled.isInteger()) {
    throw new Error(`USDC amount precision exceeded ${USDC_DECIMALS} decimals: ${String(amount)}`);
  }
  return BigInt(scaled.toFixed(0));
}

/**
 * Convert raw SPL token units (bigint) back to a fixed-precision USDC string.
 * Always returns exactly USDC_DECIMALS digits after the decimal point so values
 * round-trip cleanly through ledger serialisation.
 */
export function fromRawUnits(raw: bigint): string {
  return new Decimal(raw.toString()).div(SCALE).toFixed(USDC_DECIMALS);
}
