import { describe, expect, it } from 'vitest';
import { generateShortCode, isValidShortCode } from './short-code';

describe('generateShortCode', () => {
  it('returns a string of the requested length', () => {
    expect(generateShortCode(12)).toHaveLength(12);
    expect(generateShortCode(8)).toHaveLength(8);
  });

  it('uses only the safe base58 alphabet (no 0/O/I/l)', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateShortCode(12);
      expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/);
    }
  });

  it('produces statistically unique codes', () => {
    const codes = new Set(Array.from({ length: 1_000 }, () => generateShortCode(12)));
    expect(codes.size).toBe(1_000);
  });

  it('rejects invalid lengths', () => {
    expect(() => generateShortCode(0)).toThrow();
    expect(() => generateShortCode(64)).toThrow();
  });
});

describe('isValidShortCode', () => {
  it('accepts a freshly generated code', () => {
    expect(isValidShortCode(generateShortCode(12))).toBe(true);
  });

  it('rejects codes containing ambiguous characters', () => {
    expect(isValidShortCode('abcdef0hijkl')).toBe(false); // contains 0
    expect(isValidShortCode('abcdefOhijkl')).toBe(false); // contains O
    expect(isValidShortCode('abcdef1hijkl')).toBe(false); // contains 1
    expect(isValidShortCode('abcdefIhijkl')).toBe(false); // contains I
    expect(isValidShortCode('abcdeflhijkl')).toBe(false); // contains l
  });

  it('rejects too short / too long values', () => {
    expect(isValidShortCode('abc')).toBe(false);
    expect(isValidShortCode('a'.repeat(40))).toBe(false);
  });
});
