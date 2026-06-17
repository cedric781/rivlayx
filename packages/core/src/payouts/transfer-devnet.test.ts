import { describe, expect, it } from 'vitest';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';
import { TransferPermanentError } from './errors';
import { DevnetSolanaTransferProvider, type DevnetConfig } from './transfer-devnet';

/**
 * These tests cover only the branches that fail BEFORE any network call — config
 * validation, key/address parsing, and amount checks. The live on-chain path
 * (`getOrCreateAssociatedTokenAccount` onward) needs a funded devnet vault and
 * is exercised manually, not in CI.
 */

const VALID_DEST = 'So11111111111111111111111111111111111111112';
const VALID_MINT = Keypair.generate().publicKey.toBase58();
const VALID_VAULT_KEY = bs58.encode(Keypair.generate().secretKey);

function provider(overrides: Partial<DevnetConfig> = {}) {
  return new DevnetSolanaTransferProvider({
    rpcUrl: 'https://api.devnet.solana.com',
    vaultSecretKeyBase58: VALID_VAULT_KEY,
    usdcMint: VALID_MINT,
    ...overrides,
  });
}

function input(overrides: Partial<{ toWallet: string; amountUsdc: string }> = {}) {
  return { reference: 'wr-1', betId: 'wr-1', toWallet: VALID_DEST, amountUsdc: '10', ...overrides };
}

describe('DevnetSolanaTransferProvider — config + validation (permanent, no network)', () => {
  it('fails permanently when the vault key is missing (not configured)', async () => {
    await expect(
      provider({ vaultSecretKeyBase58: undefined }).buildAndSubmitTransfer(input()),
    ).rejects.toBeInstanceOf(TransferPermanentError);
  });

  it('fails permanently when the rpc url is missing', async () => {
    await expect(provider({ rpcUrl: '' }).buildAndSubmitTransfer(input())).rejects.toBeInstanceOf(
      TransferPermanentError,
    );
  });

  it('fails permanently when the usdc mint is missing', async () => {
    await expect(provider({ usdcMint: '' }).buildAndSubmitTransfer(input())).rejects.toBeInstanceOf(
      TransferPermanentError,
    );
  });

  it('fails permanently on an invalid vault key without leaking the key material', async () => {
    const badKey = bs58.encode(Buffer.from([1, 2, 3, 4])); // valid base58, wrong length
    const err = await provider({ vaultSecretKeyBase58: badKey })
      .buildAndSubmitTransfer(input())
      .catch((e) => e);
    expect(err).toBeInstanceOf(TransferPermanentError);
    expect((err as Error).message).not.toContain(badKey);
  });

  it('fails permanently on a non-base58 vault key', async () => {
    await expect(
      provider({ vaultSecretKeyBase58: 'not-base58-0OIl!!!' }).buildAndSubmitTransfer(input()),
    ).rejects.toBeInstanceOf(TransferPermanentError);
  });

  it('fails permanently on an invalid usdc mint address', async () => {
    await expect(
      provider({ usdcMint: 'definitely-not-a-pubkey' }).buildAndSubmitTransfer(input()),
    ).rejects.toBeInstanceOf(TransferPermanentError);
  });

  it('fails permanently on an invalid destination wallet', async () => {
    await expect(
      provider().buildAndSubmitTransfer(input({ toWallet: 'not-a-wallet' })),
    ).rejects.toBeInstanceOf(TransferPermanentError);
  });

  it('fails permanently when the amount has more than 6 decimals', async () => {
    await expect(
      provider().buildAndSubmitTransfer(input({ amountUsdc: '10.1234567' })),
    ).rejects.toBeInstanceOf(TransferPermanentError);
  });

  it('fails permanently on a non-positive amount', async () => {
    for (const amt of ['0', '-5']) {
      await expect(
        provider().buildAndSubmitTransfer(input({ amountUsdc: amt })),
      ).rejects.toBeInstanceOf(TransferPermanentError);
    }
  });
});
