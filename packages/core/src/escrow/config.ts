import Decimal from 'decimal.js';
import { PublicKey } from '@solana/web3.js';
import { USDC_MINT_ADDRESS } from '@rivlayx/shared';
import { SOLANA_CAIP2, type SolanaCaip2 } from '../payouts/privy-signer-port';

/**
 * Escrow-wallet configuration (Phase 3, foundation only — no signing).
 *
 * Resolves + validates the single central escrow wallet, the USDC mint, the
 * target Solana cluster (CAIP-2), and the per-transfer caps. Pure: callers pass
 * the values in (the web boundary reads env later); this module never touches
 * `process.env`.
 */

/** True when `address` is a valid 32-byte base58 Solana public key. */
export function isValidSolanaAddress(address: string): boolean {
  if (!address) return false;
  try {
    return new PublicKey(address).toBase58().length > 0;
  } catch {
    return false;
  }
}

export interface EscrowConfig {
  /** Central escrow wallet address (base58). */
  escrowWallet: string;
  /** USDC SPL mint for this network. */
  usdcMint: string;
  /** CAIP-2 chain id for the target cluster. */
  caip2: SolanaCaip2;
  /** Max USDC per stake transfer (user → escrow). */
  maxStakeUsdc: string;
  /** Max USDC per settlement payout (escrow → winner) — two stakes. */
  maxPayoutUsdc: string;
}

export interface EscrowConfigInput {
  escrowWallet: string;
  network: 'devnet' | 'mainnet-beta';
  /** Defaults to the canonical USDC mint when omitted. */
  usdcMint?: string;
  /** Per-stake cap (USDC decimal string) — typically `MAX_BET_USDC`. */
  maxStakeUsdc: string;
}

const CAIP2_BY_NETWORK: Record<EscrowConfigInput['network'], SolanaCaip2> = {
  'mainnet-beta': SOLANA_CAIP2.mainnet,
  devnet: SOLANA_CAIP2.devnet,
};

/**
 * Validate + resolve the escrow config. Throws on an invalid escrow/mint
 * address or a non-positive stake cap. `maxPayoutUsdc` is derived as 2× the
 * stake cap (a settled pot is exactly two stakes).
 */
export function resolveEscrowConfig(input: EscrowConfigInput): EscrowConfig {
  if (!isValidSolanaAddress(input.escrowWallet)) {
    throw new Error(`invalid escrow wallet address: ${input.escrowWallet}`);
  }
  const usdcMint = input.usdcMint ?? USDC_MINT_ADDRESS;
  if (!isValidSolanaAddress(usdcMint)) {
    throw new Error(`invalid USDC mint address: ${usdcMint}`);
  }
  const maxStake = new Decimal(input.maxStakeUsdc);
  if (!maxStake.isFinite() || maxStake.lte(0)) {
    throw new Error(`maxStakeUsdc must be > 0 (got ${input.maxStakeUsdc})`);
  }

  return {
    escrowWallet: input.escrowWallet,
    usdcMint,
    caip2: CAIP2_BY_NETWORK[input.network],
    maxStakeUsdc: maxStake.toFixed(6),
    maxPayoutUsdc: maxStake.mul(2).toFixed(6),
  };
}
