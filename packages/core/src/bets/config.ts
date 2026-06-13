/**
 * Bet engine configuration. Production callers wire these from env; the
 * defaults are documented Fase 1 values and used in tests.
 */
export interface BetEngineConfig {
  /** Hard cap on stake per side. Mirrors `MAX_BET_USDC` env. */
  maxBetUsdc: string;
  /** Anti-spam fee charged on bet creation. Refunded on expire/cancel; recognised on accept. */
  defaultCreationFeeUsdc: string;
  /** Default settlement fee in basis points (used when no template overrides). */
  defaultSettlementFeeBps: number;
  /** Maximum time-to-acceptance for an open bet. */
  maxOpenDays: number;
  /** Minimum time-to-acceptance for an open bet (so creators can't ship 1-second bets). */
  minOpenMinutes: number;
}

export const BET_ENGINE_DEFAULTS: BetEngineConfig = {
  maxBetUsdc: '25',
  defaultCreationFeeUsdc: '0.50',
  defaultSettlementFeeBps: 250,
  maxOpenDays: 7,
  minOpenMinutes: 5,
};
