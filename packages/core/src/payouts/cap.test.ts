import { describe, expect, it } from 'vitest';
import { PayoutError } from './errors';
import { PAYOUT_LIMITS, nextBackoffMs, validatePayoutAmount } from './cap';

describe('validatePayoutAmount', () => {
  it('accepts amounts at or below the cap', () => {
    expect(() => validatePayoutAmount('0.000001')).not.toThrow();
    expect(() => validatePayoutAmount('1')).not.toThrow();
    expect(() => validatePayoutAmount('49.999999')).not.toThrow();
    expect(() => validatePayoutAmount(PAYOUT_LIMITS.maxPayoutUsdc)).not.toThrow();
  });

  it('rejects amounts above the cap', () => {
    expect(() => validatePayoutAmount('50.000001')).toThrowError(PayoutError);
    expect(() => validatePayoutAmount('1000')).toThrowError(PayoutError);
  });

  it('rejects non-positive amounts', () => {
    expect(() => validatePayoutAmount('0')).toThrowError(PayoutError);
    expect(() => validatePayoutAmount('-5')).toThrowError(PayoutError);
  });
});

describe('nextBackoffMs', () => {
  it('returns the indexed backoff and clamps at the last entry', () => {
    expect(nextBackoffMs(1)).toBe(30_000);
    expect(nextBackoffMs(2)).toBe(60_000);
    expect(nextBackoffMs(3)).toBe(180_000);
    expect(nextBackoffMs(4)).toBe(600_000);
    expect(nextBackoffMs(5)).toBe(1_800_000);
    expect(nextBackoffMs(99)).toBe(1_800_000);
  });
});
