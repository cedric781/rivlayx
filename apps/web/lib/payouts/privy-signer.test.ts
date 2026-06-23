import { describe, expect, it, vi } from 'vitest';
import { payouts } from '@rivlayx/core';
import { PrivyServerSolanaSigner, type PrivySolanaWalletApiLike } from './privy-signer';

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
