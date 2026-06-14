import { describe, expect, it } from 'vitest';
import { isValidUsername, normalizeUsernameBase, USERNAME_RE } from './username';

describe('isValidUsername', () => {
  it('accepts lowercase alphanumeric + underscore, 3–20 chars', () => {
    expect(isValidUsername('abc')).toBe(true);
    expect(isValidUsername('john_doe_99')).toBe(true);
    expect(isValidUsername('a'.repeat(20))).toBe(true);
  });

  it('rejects too short / too long / uppercase / illegal chars', () => {
    expect(isValidUsername('ab')).toBe(false);
    expect(isValidUsername('a'.repeat(21))).toBe(false);
    expect(isValidUsername('John')).toBe(false);
    expect(isValidUsername('bad-name')).toBe(false);
    expect(isValidUsername('white space')).toBe(false);
    expect(isValidUsername('emoji😀')).toBe(false);
  });
});

describe('normalizeUsernameBase', () => {
  it('lowercases and strips illegal characters', () => {
    expect(normalizeUsernameBase('John.Doe')).toBe('johndoe');
    expect(normalizeUsernameBase('Foo Bar!')).toBe('foobar');
    expect(normalizeUsernameBase('keep_under_score')).toBe('keep_under_score');
  });

  it('clamps to 20 characters', () => {
    expect(normalizeUsernameBase('a'.repeat(30))).toHaveLength(20);
  });

  it('can yield a base shorter than the minimum (caller must pad)', () => {
    expect(normalizeUsernameBase('A!')).toBe('a');
    expect(USERNAME_RE.test(normalizeUsernameBase('A!'))).toBe(false);
  });
});
