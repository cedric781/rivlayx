import { describe, expect, it } from 'vitest';
import { MockAuthProvider } from './mock';

describe('MockAuthProvider', () => {
  const provider = new MockAuthProvider();

  describe('login', () => {
    it('accepts a valid email and returns a deterministic token', async () => {
      const result = await provider.login({ email: 'alice@example.com' });
      expect(result.token).toBe('mock:alice@example.com');
    });

    it('normalises email to lowercase and trims', async () => {
      const result = await provider.login({ email: '  Alice@Example.com  ' });
      expect(result.token).toBe('mock:alice@example.com');
    });

    it('rejects malformed email', async () => {
      await expect(provider.login({ email: 'not-an-email' })).rejects.toThrow(/Invalid email/);
    });
  });

  describe('verify', () => {
    it('returns a mock identity for a valid token', async () => {
      const id = await provider.verify('mock:alice@example.com');
      expect(id.email).toBe('alice@example.com');
      expect(id.walletSource).toBe('mock_dev');
      expect(id.externalId).toMatch(/^mock_[0-9a-f]{16}$/);
      expect(id.walletAddress).toMatch(/^Mock[0-9a-f]{40}$/);
    });

    it('is deterministic across calls with same email', async () => {
      const a = await provider.verify('mock:alice@example.com');
      const b = await provider.verify('mock:alice@example.com');
      expect(a).toEqual(b);
    });

    it('produces different identities for different emails', async () => {
      const a = await provider.verify('mock:alice@example.com');
      const b = await provider.verify('mock:bob@example.com');
      expect(a.externalId).not.toBe(b.externalId);
      expect(a.walletAddress).not.toBe(b.walletAddress);
    });

    it('rejects tokens without mock prefix', async () => {
      await expect(provider.verify('privy:xyz')).rejects.toThrow(/Invalid mock token/);
    });

    it('rejects tokens with malformed email payload', async () => {
      await expect(provider.verify('mock:not-an-email')).rejects.toThrow(/Invalid email/);
    });
  });
});
