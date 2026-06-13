/**
 * USDC mainnet SPL token mint address on Solana.
 * Hardcoded — verified against every parsed deposit transaction.
 */
export const USDC_MINT_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/**
 * USDC token has 6 decimal places. 1 USDC = 1_000_000 raw token units.
 */
export const USDC_DECIMALS = 6;

/**
 * Fase 1 safety brake defaults. Actual runtime values come from env (Zod-validated
 * in apps/web/lib/env.ts). These constants document the intended caps and are used
 * by unit tests as fixtures.
 */
export const SAFETY_BRAKE_DEFAULTS = {
  MAX_BET_USDC: 25,
  MAX_TVL_USDC: 1000,
} as const;
