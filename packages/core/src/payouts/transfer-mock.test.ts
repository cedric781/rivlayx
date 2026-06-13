import { describe, expect, it } from 'vitest';
import { TransferPermanentError, TransferRetryableError } from './errors';
import { MockSolanaTransferProvider } from './transfer-mock';

const baseInput = {
  reference: '00000000-0000-0000-0000-000000000001',
  toWallet: 'WalletAbc',
  amountUsdc: '10.000000',
  betId: '11111111-1111-1111-1111-111111111111',
};

describe('MockSolanaTransferProvider', () => {
  it('returns a tx signature on first call', async () => {
    const p = new MockSolanaTransferProvider();
    const r = await p.buildAndSubmitTransfer(baseInput);
    expect(r.txSignature).toMatch(/^mocksig_/);
  });

  it('is idempotent on reference', async () => {
    const p = new MockSolanaTransferProvider();
    const r1 = await p.buildAndSubmitTransfer(baseInput);
    const r2 = await p.buildAndSubmitTransfer(baseInput);
    expect(r1.txSignature).toBe(r2.txSignature);
  });

  it('throws TransferRetryableError n times then succeeds', async () => {
    const p = new MockSolanaTransferProvider();
    p.setRetryableFailure(baseInput.reference, 2, 'rpc timeout');
    await expect(p.buildAndSubmitTransfer(baseInput)).rejects.toBeInstanceOf(
      TransferRetryableError,
    );
    await expect(p.buildAndSubmitTransfer(baseInput)).rejects.toBeInstanceOf(
      TransferRetryableError,
    );
    const r = await p.buildAndSubmitTransfer(baseInput);
    expect(r.txSignature).toMatch(/^mocksig_/);
  });

  it('throws TransferPermanentError every time when set', async () => {
    const p = new MockSolanaTransferProvider();
    p.setPermanentFailure(baseInput.reference, 'blacklisted');
    await expect(p.buildAndSubmitTransfer(baseInput)).rejects.toBeInstanceOf(
      TransferPermanentError,
    );
    await expect(p.buildAndSubmitTransfer(baseInput)).rejects.toThrow(/blacklisted/);
  });
});
