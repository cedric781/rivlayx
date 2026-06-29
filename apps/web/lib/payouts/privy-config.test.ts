import { describe, expect, it } from 'vitest';
import { payouts } from '@rivlayx/core';
import { loadEnv, type Env } from '../env';
import {
  LazyPrivyServerSolanaSigner,
} from './privy-signer';
import {
  PrivyConfigError,
  resolveHardenedPrivyConfig,
  resolveHardenedPrivySigner,
} from './privy-config';

// Real, valid 32-byte base58 Solana addresses (distinct).
const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const RELAYER = 'So11111111111111111111111111111111111111112';
const ESCROW = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
// 40 chars (passes the env length check) but contains '0' → not a valid pubkey.
const INVALID = '0'.repeat(40);

/** Minimal env that exercises the config resolver (NODE_ENV=test → fields optional). */
const FULL: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  SOLANA_USDC_MINT: MINT,
  SOLANA_RELAYER_PUBKEY: RELAYER,
  ESCROW_WALLET: ESCROW,
};
const env = (src: Record<string, string | undefined>): Env => loadEnv(src);

const stubSigner: payouts.PrivySolanaSigner = {
  signAndSend: () => Promise.resolve({ txSignature: 'stub' }),
};

describe('resolveHardenedPrivyConfig — fee payer / mint / chain / escrow', () => {
  it('resolves a fully valid config', () => {
    expect(resolveHardenedPrivyConfig(env(FULL))).toEqual({
      usdcMint: MINT,
      caip2: payouts.SOLANA_CAIP2.devnet,
      feePayer: RELAYER,
      escrowWallet: ESCROW,
      maxAmountUsdc: '25',
    });
  });

  it('selects the mainnet CAIP-2 on the mainnet-beta network', () => {
    expect(resolveHardenedPrivyConfig(env({ ...FULL, SOLANA_NETWORK: 'mainnet-beta' })).caip2).toBe(
      payouts.SOLANA_CAIP2.mainnet,
    );
  });

  it('fails closed when the relayer fee payer is missing (no system-program fallback)', () => {
    const { SOLANA_RELAYER_PUBKEY: _omit, ...noRelayer } = FULL;
    expect(() => resolveHardenedPrivyConfig(env(noRelayer))).toThrow(PrivyConfigError);
    expect(() => resolveHardenedPrivyConfig(env(noRelayer))).toThrow(/SOLANA_RELAYER_PUBKEY/);
  });

  it('fails closed on an invalid relayer fee payer', () => {
    expect(() => resolveHardenedPrivyConfig(env({ ...FULL, SOLANA_RELAYER_PUBKEY: INVALID }))).toThrow(
      /SOLANA_RELAYER_PUBKEY is not a valid/,
    );
  });

  it('fails closed when the mint is missing (no mainnet-mint fallback)', () => {
    const { SOLANA_USDC_MINT: _omit, ...noMint } = FULL;
    expect(() => resolveHardenedPrivyConfig(env(noMint))).toThrow(/SOLANA_USDC_MINT/);
  });

  it('fails closed on an invalid mint', () => {
    expect(() => resolveHardenedPrivyConfig(env({ ...FULL, SOLANA_USDC_MINT: INVALID }))).toThrow(
      /SOLANA_USDC_MINT is not a valid/,
    );
  });

  it('fails closed when the escrow wallet is missing (denylist guard)', () => {
    const { ESCROW_WALLET: _omit, ...noEscrow } = FULL;
    expect(() => resolveHardenedPrivyConfig(env(noEscrow))).toThrow(/ESCROW_WALLET/);
  });

  it('fails closed on an invalid escrow wallet', () => {
    expect(() => resolveHardenedPrivyConfig(env({ ...FULL, ESCROW_WALLET: INVALID }))).toThrow(
      /ESCROW_WALLET is not a valid/,
    );
  });

  it('rejects a relayer that equals the escrow wallet', () => {
    expect(() => resolveHardenedPrivyConfig(env({ ...FULL, SOLANA_RELAYER_PUBKEY: ESCROW }))).toThrow(
      /must not be the escrow wallet/,
    );
  });

  it('rejects a relayer that equals the USDC mint', () => {
    expect(() => resolveHardenedPrivyConfig(env({ ...FULL, SOLANA_RELAYER_PUBKEY: MINT }))).toThrow(
      /must not be the USDC mint/,
    );
  });
});

describe('resolveHardenedPrivySigner — no implicit signer', () => {
  it('returns the explicitly injected signer', () => {
    expect(resolveHardenedPrivySigner(env(FULL), stubSigner)).toBe(stubSigner);
  });

  it('fails closed when credentials are missing (no gated fallback)', () => {
    expect(() => resolveHardenedPrivySigner(env(FULL))).toThrow(PrivyConfigError);
    expect(() => resolveHardenedPrivySigner(env(FULL))).toThrow(/PRIVY_APP_ID/);
  });

  it('builds the real lazy signer when credentials are present', () => {
    const withCreds = env({ ...FULL, PRIVY_APP_ID: 'app', PRIVY_APP_SECRET: 'secret' });
    expect(resolveHardenedPrivySigner(withCreds)).toBeInstanceOf(LazyPrivyServerSolanaSigner);
  });
});
