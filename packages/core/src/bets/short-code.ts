import { randomBytes } from 'node:crypto';

/**
 * Base58 alphabet without visually ambiguous characters (`0`, `O`, `I`, `l`).
 * 56 chars × 12 positions = ~5.5e20 unique slugs — plenty for the platform's
 * scale, and short enough to be sharable on chat.
 */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const DEFAULT_LENGTH = 12;

export function generateShortCode(length: number = DEFAULT_LENGTH): string {
  if (length <= 0 || length > 32) {
    throw new Error('short code length must be between 1 and 32');
  }
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return out;
}

/** Used in tests + share-link parsing to validate user-supplied slugs. */
export function isValidShortCode(value: string): boolean {
  if (value.length < 6 || value.length > 32) return false;
  for (const ch of value) {
    if (!ALPHABET.includes(ch)) return false;
  }
  return true;
}
