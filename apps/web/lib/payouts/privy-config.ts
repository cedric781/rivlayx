import { escrow, payouts } from '@rivlayx/core';
import type { Env } from '../env';
import { LazyPrivyServerSolanaSigner } from './privy-signer';

/**
 * Relayer / fee-payer hardening (Phase 6 prerequisite). Resolves the Privy
 * transfer config FAIL-CLOSED: every signer/fee-payer/mint/chain/escrow input is
 * explicitly required and validated, with NO silent fallback, NO automatic
 * default, and NO implicit signer selection. A misconfiguration throws
 * `PrivyConfigError` at build time rather than silently signing with the wrong
 * fee-payer, the wrong mint, or a gated/placeholder signer.
 *
 * This is the only place the privy backend's authority-critical values are
 * assembled, so a wrong fee-payer / signer / chain / mint / escrow wallet cannot
 * reach `PrivySolanaTransferProvider`.
 */
export class PrivyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrivyConfigError';
  }
}

export interface HardenedPrivyConfig {
  usdcMint: string;
  caip2: payouts.SolanaCaip2;
  feePayer: string;
  escrowWallet: string;
  maxAmountUsdc: string;
}

const KNOWN_CAIP2 = new Set<string>([
  payouts.SOLANA_CAIP2.mainnet,
  payouts.SOLANA_CAIP2.devnet,
  payouts.SOLANA_CAIP2.testnet,
]);

/** Require a present, valid base58 wallet/mint address — otherwise fail closed. */
function requireAddress(value: string | undefined, name: string): string {
  if (!value) {
    throw new PrivyConfigError(`${name} is required for the privy backend (no implicit default)`);
  }
  if (!escrow.isValidSolanaAddress(value)) {
    throw new PrivyConfigError(`${name} is not a valid Solana address: ${value}`);
  }
  return value;
}

/**
 * Resolve + validate the authority-critical privy transfer config. Throws
 * `PrivyConfigError` on any missing/invalid value — never returns a partially
 * valid config.
 */
export function resolveHardenedPrivyConfig(env: Env): HardenedPrivyConfig {
  // ── Mint — explicit + valid; NO fallback to the canonical (mainnet) USDC mint. ──
  const usdcMint = requireAddress(env.SOLANA_USDC_MINT, 'SOLANA_USDC_MINT');

  // ── Chain (CAIP-2) — derived from the validated network enum + re-checked. ──
  const caip2 =
    env.SOLANA_NETWORK === 'mainnet-beta'
      ? payouts.SOLANA_CAIP2.mainnet
      : payouts.SOLANA_CAIP2.devnet;
  if (!KNOWN_CAIP2.has(caip2)) {
    throw new PrivyConfigError(`unsupported CAIP-2 for network '${env.SOLANA_NETWORK}'`);
  }

  // ── Relayer fee payer — explicit + valid; NO fallback to the system program. ──
  const feePayer = requireAddress(env.SOLANA_RELAYER_PUBKEY, 'SOLANA_RELAYER_PUBKEY');

  // ── Escrow wallet — explicit + valid so it is ALWAYS in the denied set
  // (a withdrawal can never be re-routed to escrow because the denylist was empty). ──
  const escrowWallet = requireAddress(env.ESCROW_WALLET, 'ESCROW_WALLET');

  // ── Cross-checks: the relayer must not BE the escrow authority or the mint. ──
  if (feePayer === escrowWallet) {
    throw new PrivyConfigError('relayer fee payer must not be the escrow wallet');
  }
  if (feePayer === usdcMint) {
    throw new PrivyConfigError('relayer fee payer must not be the USDC mint');
  }

  return { usdcMint, caip2, feePayer, escrowWallet, maxAmountUsdc: String(env.MAX_WITHDRAW_USDC) };
}

/**
 * Resolve the delegated signer FAIL-CLOSED. An explicitly injected signer wins
 * (tests / cutover). Otherwise app credentials are REQUIRED — there is no gated
 * or implicit signer fallback: a missing credential throws rather than producing
 * a placeholder signer.
 */
export function resolveHardenedPrivySigner(
  env: Env,
  injected?: payouts.PrivySolanaSigner,
): payouts.PrivySolanaSigner {
  if (injected) return injected;
  if (!env.PRIVY_APP_ID || !env.PRIVY_APP_SECRET) {
    throw new PrivyConfigError(
      'PRIVY_APP_ID and PRIVY_APP_SECRET are required to sign on the privy backend (no implicit/gated signer)',
    );
  }
  return new LazyPrivyServerSolanaSigner({ appId: env.PRIVY_APP_ID, appSecret: env.PRIVY_APP_SECRET });
}
