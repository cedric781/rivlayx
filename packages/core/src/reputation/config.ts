import type { ReputationTier } from '@rivlayx/db';

/**
 * All reputation tuning constants in one place — weights, normalisation
 * targets, caps, tier bands and provisional thresholds. Changing the model is a
 * config edit, not a schema change. See `docs/reputation-design.md`.
 */
export interface ReputationConfig {
  /** Positive-composite weights; must sum to 1. */
  weights: { exp: number; comp: number; vol: number; age: number; win: number };
  /** `norm(x, target)` saturation points. */
  targets: {
    distinctCounterparties: number;
    completedBets: number;
    settledVolumeUsdc: number;
    ageDays: number;
  };
  /** Max settled stake (USDC) credited per single counterparty (anti wash-trade). */
  perCounterpartyVolumeCapUsdc: number;
  integrity: {
    frivolousWeight: number;
    adverseWeight: number;
    /** Laplace smoothing added to the matched-bets denominator. */
    smoothing: number;
    /** Lowest the multiplicative integrity factor can fall to. */
    floor: number;
  };
  provisional: {
    minMatched: number;
    minDistinctCounterparties: number;
    minAgeDays: number;
    minCompleted: number;
  };
  /** Internal anomaly flag for extreme win-rates (does not affect the score). */
  winAnomaly: { minSample: number; highRate: number; lowRate: number };
  /** Suspended accounts are capped at this score. */
  suspendedScoreCap: number;
  /** Ascending lower-bound → tier (for non-provisional accounts). */
  tierBands: ReadonlyArray<{ min: number; tier: Exclude<ReputationTier, 'new'> }>;
}

export const REPUTATION_DEFAULTS: ReputationConfig = {
  weights: { exp: 0.4, comp: 0.2, vol: 0.2, age: 0.15, win: 0.05 },
  targets: {
    distinctCounterparties: 25,
    completedBets: 50,
    settledVolumeUsdc: 2000,
    ageDays: 365,
  },
  perCounterpartyVolumeCapUsdc: 100,
  integrity: { frivolousWeight: 2.0, adverseWeight: 3.0, smoothing: 5, floor: 0.1 },
  provisional: { minMatched: 3, minDistinctCounterparties: 3, minAgeDays: 7, minCompleted: 3 },
  winAnomaly: { minSample: 20, highRate: 0.95, lowRate: 0.05 },
  suspendedScoreCap: 30,
  tierBands: [
    { min: 80, tier: 'trusted' },
    { min: 60, tier: 'gold' },
    { min: 40, tier: 'silver' },
    { min: 20, tier: 'bronze' },
    { min: 0, tier: 'untrusted' },
  ],
};
