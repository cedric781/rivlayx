import { describe, expect, it } from 'vitest';
import { fromRawUnits, toRawUnits } from './usdc';

describe('USDC unit conversion', () => {
  it('converts whole numbers', () => {
    expect(toRawUnits('1')).toBe(1_000_000n);
    expect(toRawUnits(25)).toBe(25_000_000n);
  });

  it('converts fractional amounts at full precision', () => {
    expect(toRawUnits('0.000001')).toBe(1n);
    expect(toRawUnits('12.345678')).toBe(12_345_678n);
  });

  it('rejects precision beyond 6 decimals', () => {
    expect(() => toRawUnits('0.0000001')).toThrow();
  });

  it('round-trips through fromRawUnits', () => {
    const original = '42.123456';
    expect(fromRawUnits(toRawUnits(original))).toBe(original);
  });

  it('formats zero with full precision', () => {
    expect(fromRawUnits(0n)).toBe('0.000000');
  });

  it('handles large amounts safely', () => {
    expect(toRawUnits('1000000')).toBe(1_000_000_000_000n);
    expect(fromRawUnits(1_000_000_000_000n)).toBe('1000000.000000');
  });
});
