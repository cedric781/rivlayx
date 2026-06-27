import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing for first-factor admin credentials (B1).
 *
 * scrypt (memory-hard KDF, in the Node core crypto module — no native deps) with
 * a per-password random salt. The stored value is a self-describing string
 *
 *   `scrypt$<N>$<r>$<p>$<saltHex>$<hashHex>`
 *
 * so the work parameters travel with the hash and can be raised later without
 * breaking existing rows. Verification is constant-time (`timingSafeEqual`).
 *
 * Lives in `@rivlayx/shared` (zero-dep, server-only sub-path) so both the auth
 * package and the DB seed script can reuse one implementation — it is NOT
 * re-exported from the shared barrel, keeping `node:crypto` out of any client
 * bundle that imports `@rivlayx/shared` for formatting helpers.
 */

// OWASP-aligned scrypt work factors. N must be a power of two.
const N = 16384;
const R = 8;
const P = 1;
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const MAX_MEM = 64 * 1024 * 1024; // scrypt needs ~128*N*r bytes; raise the default cap.

/** Hash a plaintext password into a self-describing `scrypt$…` string. */
export function hashPassword(password: string): string {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('password must be a non-empty string');
  }
  const salt = randomBytes(SALT_BYTES);
  const derived = scryptSync(password, salt, KEY_BYTES, { N, r: R, p: P, maxmem: MAX_MEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/**
 * Verify `password` against a stored `scrypt$…` hash in constant time.
 * Returns `false` (never throws) on any malformed/mismatched input so callers
 * can treat every failure mode as a plain auth rejection.
 */
export function verifyPassword(password: string, stored: string): boolean {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const saltHex = parts[4]!;
  const hashHex = parts[5]!;
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, 'hex');
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let derived: Buffer;
  try {
    derived = scryptSync(password, salt, expected.length, { N: n, r, p, maxmem: MAX_MEM });
  } catch {
    return false;
  }
  // Lengths are equal by construction (derived to expected.length), but guard anyway.
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
