import { describe, expect, it } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { USDC_MINT_ADDRESS } from '@rivlayx/shared';
import { SOLANA_CAIP2 } from '../payouts/privy-signer-port';
import { isValidSolanaAddress, resolveEscrowConfig } from './config';

const VALID = Keypair.generate().publicKey.toBase58();

describe('isValidSolanaAddress', () => {
  it('accepts a real base58 public key', () => {
    expect(isValidSolanaAddress(VALID)).toBe(true);
    expect(isValidSolanaAddress(USDC_MINT_ADDRESS)).toBe(true);
  });

  it('rejects malformed or empty input', () => {
    expect(isValidSolanaAddress('')).toBe(false);
    expect(isValidSolanaAddress('not-an-address')).toBe(false);
    expect(isValidSolanaAddress('0OIl')).toBe(false); // base58-illegal chars
  });
});

describe('resolveEscrowConfig', () => {
  it('resolves a valid devnet config with derived payout cap', () => {
    const cfg = resolveEscrowConfig({ escrowWallet: VALID, network: 'devnet', maxStakeUsdc: '25' });
    expect(cfg.escrowWallet).toBe(VALID);
    expect(cfg.usdcMint).toBe(USDC_MINT_ADDRESS);
    expect(cfg.caip2).toBe(SOLANA_CAIP2.devnet);
    expect(cfg.maxStakeUsdc).toBe('25.000000');
    expect(cfg.maxPayoutUsdc).toBe('50.000000'); // 2× stake
  });

  it('maps mainnet-beta to the mainnet CAIP-2', () => {
    const cfg = resolveEscrowConfig({ escrowWallet: VALID, network: 'mainnet-beta', maxStakeUsdc: '25' });
    expect(cfg.caip2).toBe(SOLANA_CAIP2.mainnet);
  });

  it('accepts an explicit USDC mint override', () => {
    const mint = Keypair.generate().publicKey.toBase58();
    const cfg = resolveEscrowConfig({ escrowWallet: VALID, network: 'devnet', usdcMint: mint, maxStakeUsdc: '10' });
    expect(cfg.usdcMint).toBe(mint);
  });

  it('throws on an invalid escrow wallet address', () => {
    expect(() => resolveEscrowConfig({ escrowWallet: 'bad', network: 'devnet', maxStakeUsdc: '25' })).toThrow(
      /escrow wallet/,
    );
  });

  it('throws on an invalid USDC mint', () => {
    expect(() =>
      resolveEscrowConfig({ escrowWallet: VALID, network: 'devnet', usdcMint: 'bad', maxStakeUsdc: '25' }),
    ).toThrow(/USDC mint/);
  });

  it('throws on a non-positive stake cap', () => {
    expect(() => resolveEscrowConfig({ escrowWallet: VALID, network: 'devnet', maxStakeUsdc: '0' })).toThrow();
    expect(() => resolveEscrowConfig({ escrowWallet: VALID, network: 'devnet', maxStakeUsdc: '-5' })).toThrow();
  });
});
