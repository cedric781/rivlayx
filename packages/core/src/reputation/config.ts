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
  /**
   * Arbiter (adjudicator) reputation — same tier bands, separate composite.
   * Hardened in Sprint 16.5: independence (distinct creators/participants) gates
   * the tier so self-assigned alt-account farming can't reach Gold/Trusted.
   */
  arbiter: {
    /** Sum to 1. Priority: accuracy > independence ≈ acceptance > experience > platform. */
    weights: {
      accuracy: number;
      acceptance: number;
      independence: number;
      experience: number;
      platform: number;
    };
    /** `norm(rulings, target)` saturation point (experience). */
    rulingsTarget: number;
    /** `norm(distinctParticipants, target)` saturation point (independence). */
    participantsTarget: number;
    /** Floor to leave provisional ("New") at all. */
    provisional: { minRulings: number; minDistinctCreators: number; minDistinctParticipants: number };
    /** Hard eligibility for the `trusted` tier. */
    trusted: {
      minRulings: number;
      minDistinctCreators: number;
      minDistinctParticipants: number;
      maxOverturnedRate: number;
    };
    /** Hard eligibility for the `gold` tier. */
    gold: { minRulings: number; minDistinctCreators: number; minDistinctParticipants: number };
  };
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
  arbiter: {
    weights: { accuracy: 0.55, acceptance: 0.15, independence: 0.15, experience: 0.1, platform: 0.05 },
    rulingsTarget: 30,
    participantsTarget: 25,
    provisional: { minRulings: 10, minDistinctCreators: 10, minDistinctParticipants: 10 },
    trusted: {
      minRulings: 25,
      minDistinctCreators: 15,
      minDistinctParticipants: 25,
      maxOverturnedRate: 0.02,
    },
    gold: { minRulings: 10, minDistinctCreators: 5, minDistinctParticipants: 10 },
  },
};
