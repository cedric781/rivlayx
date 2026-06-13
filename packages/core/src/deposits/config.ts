/**
 * Deposit pipeline configuration. Values come from env at the API layer
 * (`apps/web/lib/env.ts`); the constants here document the intended Fase 1
 * defaults and are used as fixtures in tests.
 */
export interface DepositConfig {
  /** Minimum accepted per-deposit amount. Anything smaller is dust-rejected. */
  minDepositUsdc: string;
  /** Maximum accepted per-deposit amount. Single-shot cap. */
  maxSingleDepositUsdc: string;
  /** Hard total-value-locked cap across the platform. */
  maxTvlUsdc: string;
  /** Vault ATA that legitimate deposits must target. */
  expectedDestAta: string;
}

export const DEPOSIT_DEFAULTS = {
  minDepositUsdc: '5',
  maxSingleDepositUsdc: '250',
  maxTvlUsdc: '1000',
} as const;

/**
 * Slot count for `finalized` commitment on Solana mainnet. Used by
 * `confirmDeposit` as the bar for crediting a deposit to the ledger.
 */
export const REQUIRED_CONFIRMATIONS = 32;
