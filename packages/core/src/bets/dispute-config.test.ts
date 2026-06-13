import { describe, expect, it } from 'vitest';
import { DISPUTE_DEFAULTS, computeDisputeDeposit } from './dispute-config';

describe('computeDisputeDeposit — default 15% / [$5, $500] bounds', () => {
  it('uses the percentage when in-bounds', () => {
    // pot 100 → 15% = 15
    expect(computeDisputeDeposit('100')).toBe('15.000000');
    // pot 200 → 30
    expect(computeDisputeDeposit('200')).toBe('30.000000');
    // pot 50 → 7.50
    expect(computeDisputeDeposit('50')).toBe('7.500000');
  });

  it('clamps to min when raw < min', () => {
    // pot 20 × 15% = 3 → clamped to 5
    expect(computeDisputeDeposit('20')).toBe('5.000000');
    // pot 1 × 15% = 0.15 → clamped to 5
    expect(computeDisputeDeposit('1')).toBe('5.000000');
  });

  it('clamps to max when raw > max', () => {
    // pot 10000 × 15% = 1500 → clamped to 500
    expect(computeDisputeDeposit('10000')).toBe('500.000000');
  });

  it('honours custom config', () => {
    const cfg = { depositPct: '0.20', minDepositUsdc: '2', maxDepositUsdc: '50' };
    expect(computeDisputeDeposit('100', cfg)).toBe('20.000000');
    expect(computeDisputeDeposit('5', cfg)).toBe('2.000000');
    expect(computeDisputeDeposit('1000', cfg)).toBe('50.000000');
  });

  it('rejects non-positive pot', () => {
    expect(() => computeDisputeDeposit('0')).toThrow();
    expect(() => computeDisputeDeposit('-10')).toThrow();
  });

  it('rejects out-of-range percentage in config', () => {
    expect(() =>
      computeDisputeDeposit('100', { ...DISPUTE_DEFAULTS, depositPct: '1.5' }),
    ).toThrow();
    expect(() =>
      computeDisputeDeposit('100', { ...DISPUTE_DEFAULTS, depositPct: '-0.1' }),
    ).toThrow();
  });

  it('rejects min > max config', () => {
    expect(() =>
      computeDisputeDeposit('100', {
        ...DISPUTE_DEFAULTS,
        minDepositUsdc: '100',
        maxDepositUsdc: '5',
      }),
    ).toThrow();
  });
});
