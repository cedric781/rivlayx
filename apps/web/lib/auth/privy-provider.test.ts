import { describe, expect, it } from 'vitest';
import {
  createPrivyAuthProvider,
  type PrivyClientLike,
  type PrivyUserLike,
} from './privy-provider';

function makeStubClient(user: PrivyUserLike): PrivyClientLike {
  return {
    verifyAuthToken: (token: string) => {
      if (token === 'bad') return Promise.reject(new Error('invalid token'));
      return Promise.resolve({ userId: user.id });
    },
    getUserById: (userId: string) => {
      if (userId !== user.id) return Promise.reject(new Error('not found'));
      return Promise.resolve(user);
    },
  };
}

describe('PrivyAuthProvider.verify', () => {
  it('returns a VerifiedIdentity for a token tied to a Solana embedded wallet', async () => {
    const provider = await createPrivyAuthProvider({
      appId: 'a',
      appSecret: 's',
      client: makeStubClient({
        id: 'did:privy:abc123',
        email: { address: 'alice@example.com' },
        linkedAccounts: [
          {
            type: 'wallet',
            chainType: 'solana',
            walletClientType: 'privy',
            address: 'SolanaAddr1111111111111111111111111111111111',
          },
        ],
      }),
    });

    const id = await provider.verify('any-token');
    expect(id.externalId).toBe('did:privy:abc123');
    expect(id.email).toBe('alice@example.com');
    expect(id.walletAddress).toBe('SolanaAddr1111111111111111111111111111111111');
    expect(id.walletSource).toBe('privy_embedded');
  });

  it('falls back to empty email when Privy user has no email', async () => {
    const provider = await createPrivyAuthProvider({
      appId: 'a',
      appSecret: 's',
      client: makeStubClient({
        id: 'did:privy:def',
        linkedAccounts: [
          {
            type: 'wallet',
            chainType: 'solana',
            address: 'AnotherAddr11111111111111111111111111111111',
          },
        ],
      }),
    });
    const id = await provider.verify('any-token');
    expect(id.email).toBe('');
  });

  it('rejects when Privy account has no Solana wallet', async () => {
    const provider = await createPrivyAuthProvider({
      appId: 'a',
      appSecret: 's',
      client: makeStubClient({
        id: 'did:privy:eth-only',
        email: { address: 'eth@example.com' },
        linkedAccounts: [
          {
            type: 'wallet',
            chainType: 'ethereum',
            address: '0xabc',
          },
        ],
      }),
    });
    await expect(provider.verify('any-token')).rejects.toThrow(/No Solana wallet/);
  });

  it('ignores Solana-typed accounts with no address', async () => {
    const provider = await createPrivyAuthProvider({
      appId: 'a',
      appSecret: 's',
      client: makeStubClient({
        id: 'did:privy:nullish',
        linkedAccounts: [{ type: 'wallet', chainType: 'solana' }],
      }),
    });
    await expect(provider.verify('any-token')).rejects.toThrow(/No Solana wallet/);
  });

  it('propagates token verification failures', async () => {
    const provider = await createPrivyAuthProvider({
      appId: 'a',
      appSecret: 's',
      client: makeStubClient({
        id: 'did:privy:abc',
        linkedAccounts: [
          { type: 'wallet', chainType: 'solana', address: 'addr111111111111111111111111111111' },
        ],
      }),
    });
    await expect(provider.verify('bad')).rejects.toThrow(/invalid token/);
  });
});

describe('PrivyAuthProvider.login', () => {
  it('refuses server-side login (Privy is client-driven)', async () => {
    const provider = await createPrivyAuthProvider({
      appId: 'a',
      appSecret: 's',
      client: makeStubClient({
        id: 'did:privy:x',
        linkedAccounts: [
          { type: 'wallet', chainType: 'solana', address: 'addr111111111111111111111111111111' },
        ],
      }),
    });
    await expect(provider.login({ email: 'x@example.com' })).rejects.toThrow(
      /does not support server-side login/,
    );
  });
});
