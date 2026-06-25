import { describe, expect, it, vi } from 'vitest';
import { payouts } from '@rivlayx/core';
import {
  LazyPrivyServerSolanaSigner,
  PrivyServerSolanaSigner,
  type PrivySolanaWalletApiLike,
} from './privy-signer';

const DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';

function stubClient(
  impl: (input: {
    address: string;
    chainType: 'solana';
    caip2: string;
    transaction: unknown;
    idempotencyKey?: string;
  }) => Promise<{ signature?: string; hash?: string }>,
): { client: PrivySolanaWalletApiLike; calls: unknown[] } {
  const calls: unknown[] = [];
  const client: PrivySolanaWalletApiLike = {
    walletApi: {
      solana: {
        signAndSendTransaction: (input) => {
          calls.push(input);
          return impl(input);
        },
      },
    },
  };
  return { client, calls };
}

const req = {
  fromWallet: 'UserWallet1111111111111111111111111111111111',
  caip2: DEVNET,
  idempotencyKey: 'stake:bet1:user1',
  transaction: { __opaque: 'tx' },
};

describe('PrivyServerSolanaSigner', () => {
  it('forwards address/caip2/idempotencyKey/transaction to Privy and returns the signature', async () => {
    const { client, calls } = stubClient(() => Promise.resolve({ signature: 'SIG_123' }));
    const signer = new PrivyServerSolanaSigner(client);

    const res = await signer.signAndSend(req);
    expect(res.txSignature).toBe('SIG_123');
    expect(calls).toEqual([
      {
        address: req.fromWallet,
        chainType: 'solana',
        caip2: DEVNET,
        transaction: req.transaction,
        idempotencyKey: 'stake:bet1:user1',
      },
    ]);
  });

  it('falls back to the `hash` field when `signature` is absent', async () => {
    const { client } = stubClient(() => Promise.resolve({ hash: 'HASH_456' }));
    const res = await new PrivyServerSolanaSigner(client).signAndSend(req);
    expect(res.txSignature).toBe('HASH_456');
  });

  it('throws a retryable error when no signature is returned', async () => {
    const { client } = stubClient(() => Promise.resolve({}));
    await expect(new PrivyServerSolanaSigner(client).signAndSend(req)).rejects.toBeInstanceOf(
      payouts.TransferRetryableError,
    );
  });

  it('maps transient Privy errors to retryable', async () => {
    const { client } = stubClient(() => Promise.reject(new Error('node is behind / rate limit')));
    await expect(new PrivyServerSolanaSigner(client).signAndSend(req)).rejects.toBeInstanceOf(
      payouts.TransferRetryableError,
    );
  });

  it('maps policy/invalid errors to permanent', async () => {
    const { client } = stubClient(() => Promise.reject(new Error('transaction denied by wallet policy')));
    await expect(new PrivyServerSolanaSigner(client).signAndSend(req)).rejects.toBeInstanceOf(
      payouts.TransferPermanentError,
    );
  });

  it('does not call Privy more than once per signAndSend', async () => {
    const spy = vi.fn(() => Promise.resolve({ signature: 'S' }));
    const client: PrivySolanaWalletApiLike = {
      walletApi: { solana: { signAndSendTransaction: spy } },
    };
    await new PrivyServerSolanaSigner(client).signAndSend(req);
    expect(spy).toHaveBeenCalledOnce();
  });
});

describe('LazyPrivyServerSolanaSigner', () => {
  it('builds the client lazily on first sign and delegates to it', async () => {
    const spy = vi.fn(() => Promise.resolve({ signature: 'LAZY_SIG' }));
    const client: PrivySolanaWalletApiLike = {
      walletApi: { solana: { signAndSendTransaction: spy } },
    };
    let built = 0;
    const signer = new LazyPrivyServerSolanaSigner({
      appId: 'app',
      appSecret: 'secret',
      buildClient: () => {
        built += 1;
        return client;
      },
    });

    expect(built).toBe(0); // construction does not build the client
    const res = await signer.signAndSend(req);
    expect(res.txSignature).toBe('LAZY_SIG');
    expect(built).toBe(1);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('caches the client across signs (built once)', async () => {
    const spy = vi.fn(() => Promise.resolve({ signature: 'S' }));
    const client: PrivySolanaWalletApiLike = {
      walletApi: { solana: { signAndSendTransaction: spy } },
    };
    let built = 0;
    const signer = new LazyPrivyServerSolanaSigner({
      appId: 'app',
      appSecret: 'secret',
      buildClient: () => {
        built += 1;
        return Promise.resolve(client);
      },
    });

    await signer.signAndSend(req);
    await signer.signAndSend(req);
    expect(built).toBe(1); // client built once, reused
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('propagates the underlying signer error mapping (permanent on policy denial)', async () => {
    const client: PrivySolanaWalletApiLike = {
      walletApi: {
        solana: {
          signAndSendTransaction: () => Promise.reject(new Error('denied by wallet policy')),
        },
      },
    };
    const signer = new LazyPrivyServerSolanaSigner({
      appId: 'app',
      appSecret: 'secret',
      buildClient: () => client,
    });
    await expect(signer.signAndSend(req)).rejects.toBeInstanceOf(payouts.TransferPermanentError);
  });
});
