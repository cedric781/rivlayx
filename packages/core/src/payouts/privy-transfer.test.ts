import { describe, expect, it } from 'vitest';
import { Keypair, Transaction } from '@solana/web3.js';
import { USDC_MINT_ADDRESS } from '@rivlayx/shared';
import { TransferPermanentError, TransferRetryableError } from './errors';
import { PrivySolanaTransferProvider } from './privy-transfer';
import { SOLANA_CAIP2, type PrivySignAndSendRequest } from './privy-signer-port';
import type { PrivyTransferPolicy } from './privy-policy';

const addr = () => Keypair.generate().publicKey.toBase58();

/** Mock signer capturing each request; behaviour configurable per test. */
function mockSigner(behavior: (req: PrivySignAndSendRequest) => Promise<{ txSignature: string }>) {
  const calls: PrivySignAndSendRequest[] = [];
  return {
    calls,
    signAndSend(req: PrivySignAndSendRequest) {
      calls.push(req);
      return behavior(req);
    },
  };
}

function setup(behavior?: (req: PrivySignAndSendRequest) => Promise<{ txSignature: string }>) {
  const escrow = addr();
  const user = addr();
  const feePayer = addr();
  const policy: PrivyTransferPolicy = {
    usdcMint: USDC_MINT_ADDRESS,
    allowedDestinations: [escrow],
    maxAmountUsdc: '25',
  };
  const signer = mockSigner(behavior ?? (() => Promise.resolve({ txSignature: 'SIG_OK' })));
  const provider = new PrivySolanaTransferProvider({
    signer,
    policy,
    caip2: SOLANA_CAIP2.devnet,
    feePayer,
  });
  return { provider, signer, escrow, user, feePayer };
}

const input = (over: Record<string, unknown>) => ({
  reference: 'stake:bet1:user1',
  toWallet: '',
  amountUsdc: '10',
  betId: 'bet1',
  ...over,
});

describe('PrivySolanaTransferProvider', () => {
  it('builds a single USDC transfer, signs with idempotencyKey=reference, returns the signature', async () => {
    const { provider, signer, escrow, user, feePayer } = setup();
    const res = await provider.buildAndSubmitTransfer(
      input({ toWallet: escrow, fromWallet: user }),
    );
    expect(res.txSignature).toBe('SIG_OK');

    expect(signer.calls).toHaveLength(1);
    const req = signer.calls[0]!;
    expect(req.fromWallet).toBe(user);
    expect(req.caip2).toBe(SOLANA_CAIP2.devnet);
    expect(req.idempotencyKey).toBe('stake:bet1:user1');
    expect(req.transaction).toBeInstanceOf(Transaction);
    const tx = req.transaction as Transaction;
    expect(tx.instructions).toHaveLength(1);
    expect(tx.feePayer?.toBase58()).toBe(feePayer);
  });

  it('rejects (permanent) and never signs when fromWallet is missing', async () => {
    const { provider, signer, escrow } = setup();
    await expect(provider.buildAndSubmitTransfer(input({ toWallet: escrow }))).rejects.toThrow(
      TransferPermanentError,
    );
    expect(signer.calls).toHaveLength(0);
  });

  it('rejects (permanent) and never signs when the amount exceeds the cap', async () => {
    const { provider, signer, escrow, user } = setup();
    await expect(
      provider.buildAndSubmitTransfer(input({ toWallet: escrow, fromWallet: user, amountUsdc: '26' })),
    ).rejects.toThrow(TransferPermanentError);
    expect(signer.calls).toHaveLength(0);
  });

  it('rejects (permanent) and never signs for a non-allowlisted destination', async () => {
    const { provider, signer, user } = setup();
    await expect(
      provider.buildAndSubmitTransfer(input({ toWallet: addr(), fromWallet: user })),
    ).rejects.toThrow(TransferPermanentError);
    expect(signer.calls).toHaveLength(0);
  });

  it('passes through a retryable signer error', async () => {
    const s = setup(() => Promise.reject(new TransferRetryableError('rpc down')));
    await expect(
      s.provider.buildAndSubmitTransfer(input({ toWallet: s.escrow, fromWallet: s.user })),
    ).rejects.toThrow(TransferRetryableError);
  });

  it('passes through a permanent signer error', async () => {
    const s = setup(() => Promise.reject(new TransferPermanentError('blacklisted')));
    await expect(
      s.provider.buildAndSubmitTransfer(input({ toWallet: s.escrow, fromWallet: s.user })),
    ).rejects.toThrow(TransferPermanentError);
  });

  it('wraps an unknown signer error as retryable', async () => {
    const s = setup(() => Promise.reject(new Error('socket hang up')));
    await expect(
      s.provider.buildAndSubmitTransfer(input({ toWallet: s.escrow, fromWallet: s.user })),
    ).rejects.toThrow(TransferRetryableError);
  });

  it('forwards the same idempotency key on a replay (idempotency delegated to the signer)', async () => {
    const s = setup();
    const args = input({ toWallet: s.escrow, fromWallet: s.user });
    await s.provider.buildAndSubmitTransfer(args);
    await s.provider.buildAndSubmitTransfer(args);
    expect(s.signer.calls.map((c) => c.idempotencyKey)).toEqual([
      'stake:bet1:user1',
      'stake:bet1:user1',
    ]);
  });
});
