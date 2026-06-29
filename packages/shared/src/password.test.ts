import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password hashing (scrypt)', () => {
  it('round-trips a correct password', () => {
    const hash = hashPassword('correct horse battery staple');
    expect(verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects a wrong password', () => {
    const hash = hashPassword('s3cret-admin-pw');
    expect(verifyPassword('s3cret-admin-pX', hash)).toBe(false);
    expect(verifyPassword('', hash)).toBe(false);
  });

  it('produces a fresh salt per call (same password → different hashes)', () => {
    const a = hashPassword('same-password');
    const b = hashPassword('same-password');
    expect(a).not.toEqual(b);
    // Both still verify.
    expect(verifyPassword('same-password', a)).toBe(true);
    expect(verifyPassword('same-password', b)).toBe(true);
  });

  it('emits the self-describing scrypt$N$r$p$salt$hash format', () => {
    const hash = hashPassword('x');
    const parts = hash.split('$');
    expect(parts[0]).toBe('scrypt');
    expect(parts).toHaveLength(6);
    expect(Number(parts[1])).toBeGreaterThan(0); // N
  });

  it('fails closed on a tampered or malformed stored hash (never throws)', () => {
    const hash = hashPassword('pw');
    const tampered = hash.slice(0, -2) + 'ff';
    expect(verifyPassword('pw', tampered)).toBe(false);
    expect(verifyPassword('pw', 'not-a-hash')).toBe(false);
    expect(verifyPassword('pw', 'scrypt$bad$bad$bad$bad$bad')).toBe(false);
    expect(verifyPassword('pw', '')).toBe(false);
  });

  it('refuses to hash an empty password', () => {
    expect(() => hashPassword('')).toThrow();
  });
});
