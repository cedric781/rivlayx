import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Authenticated symmetric encryption for secrets-at-rest (C5: TOTP secrets).
 *
 * AES-256-GCM. The stored blob is `base64(iv ‖ authTag ‖ ciphertext)` where the
 * 12-byte IV is random per call and the 16-byte GCM tag authenticates the
 * payload — a tampered blob fails `decryptSecret` instead of returning garbage.
 *
 * The key is passed in (never read from `process.env` here) so this module
 * stays pure and unit-testable; the admin app resolves `MFA_ENCRYPTION_KEY`
 * from env and threads it in.
 */

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/** Decode + validate a base64 32-byte key. Throws on wrong length. */
export function decodeEncryptionKey(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `MFA encryption key must decode to ${KEY_BYTES} bytes (got ${key.length}); generate with \`openssl rand -base64 32\``,
    );
  }
  return key;
}

/** Encrypt `plaintext` → base64(iv ‖ tag ‖ ciphertext). */
export function encryptSecret(plaintext: string, keyBase64: string): string {
  const key = decodeEncryptionKey(keyBase64);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

/** Decrypt a blob produced by {@link encryptSecret}. Throws if tampered. */
export function decryptSecret(blob: string, keyBase64: string): string {
  const key = decodeEncryptionKey(keyBase64);
  const raw = Buffer.from(blob, 'base64');
  if (raw.length < IV_BYTES + TAG_BYTES) {
    throw new Error('MFA secret blob is malformed (too short)');
  }
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
