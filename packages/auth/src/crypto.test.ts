import { describe, expect, it } from 'vitest';
import { decodeEncryptionKey, decryptSecret, encryptSecret } from './crypto';

// Deterministic 32-byte test key (base64). Not a real secret.
const KEY = Buffer.alloc(32, 7).toString('base64');

describe('MFA secret encryption (AES-256-GCM)', () => {
  it('round-trips a secret', () => {
    const blob = encryptSecret('JBSWY3DPEHPK3PXP', KEY);
    expect(blob).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(blob, KEY)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('produces a fresh IV per call (ciphertext differs)', () => {
    const a = encryptSecret('same-secret', KEY);
    const b = encryptSecret('same-secret', KEY);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, KEY)).toBe('same-secret');
    expect(decryptSecret(b, KEY)).toBe('same-secret');
  });

  it('fails to decrypt a tampered blob (GCM auth tag)', () => {
    const raw = Buffer.from(encryptSecret('secret', KEY), 'base64');
    const last = raw.length - 1;
    raw.writeUInt8(raw.readUInt8(last) ^ 0xff, last); // flip a ciphertext byte
    const tampered = raw.toString('base64');
    expect(() => decryptSecret(tampered, KEY)).toThrow();
  });

  it('fails to decrypt with the wrong key', () => {
    const blob = encryptSecret('secret', KEY);
    const otherKey = Buffer.alloc(32, 9).toString('base64');
    expect(() => decryptSecret(blob, otherKey)).toThrow();
  });

  it('rejects a key of the wrong length', () => {
    const shortKey = Buffer.alloc(16, 1).toString('base64');
    expect(() => decodeEncryptionKey(shortKey)).toThrow(/32 bytes/);
    expect(() => encryptSecret('x', shortKey)).toThrow(/32 bytes/);
  });
});
