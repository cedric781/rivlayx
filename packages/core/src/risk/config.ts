import type { RiskBand } from '@rivlayx/db';

/**
 * All risk-engine tuning in one place — weights, gates, thresholds and bands.
 * Tuning the model is a config edit, not a schema change. Shadow mode: these
 * values drive scoring and alerting only; nothing here enforces anything.
 * See `docs/risk-engine-design.md`.
 */
export interface RiskConfig {
  /** Primary composite weights (priority order). MUST sum to 1. */
  weights: {
    ring: number;
    arbiterConcentration: number;
    concentration: number;
    wash: number;
    abuse: number;
    velocity: number;
  };
  /** Counterparty-graph clustering (strong edges form clusters). */
  graph: {
    /** A pair needs this many shared bets to count as a strong (cluster) edge. */
    strongEdgeMinBets: number;
    /** Top-k counterparties used for the repeated-counterparty ratio. */
    topCounterparties: number;
    /** Recent window (days) for velocity vs the trailing baseline. */
    recentWindowDays: number;
    /** Trailing baseline window (days). */
    baselineWindowDays: number;
  };
  /** Ring sub-signal blend (sums to 1). */
  ring: {
    cohesionWeight: number;
    repeatedCounterpartyWeight: number;
    arbiterOverlapWeight: number;
    /** Cluster must be at least this active before ring can score. */
    minClusterSize: number;
    minClusterVolumeUsdc: number;
  };
  /** Arbiter-concentration blend (sums to 1) + gate. */
  arbiterConcentration: {
    creatorShareWeight: number;
    acceptorShareWeight: number;
    clusterShareWeight: number;
    /** Below this many user-selected ruled bets the signal is suppressed. */
    minRuledBets: number;
  };
  /** Counterparty-concentration: HHI floor below which no credit is given. */
  concentration: { hhiFloor: number; minCounterparties: number };
  /** Wash-trading thresholds. */
  wash: {
    minRoundTrips: number;
    /** Reciprocal volume saturating the volume weight. */
    volumeTargetUsdc: number;
  };
  /** Dispute-abuse blend (sums to 1) + smoothing + baseline. */
  abuse: {
    frivolousWeight: number;
    excessWeight: number;
    patternWeight: number;
    /** Laplace smoothing on the frivolous denominator. */
    smoothing: number;
    /** Platform baseline dispute rate; excess measured relative to it. */
    baselineDisputeRate: number;
  };
  /** Velocity: spike ratio that maps to signal 1.0; min baseline activity. */
  velocity: { spikeSaturation: number; minBaselineBets: number };
  /** Funding overlap: supporting only — gated + capped. */
  funding: {
    /** Distinct shared-source users saturating the funding signal. */
    saturationUsers: number;
    /** Primary must reach this before any funding boost applies. */
    minPrimaryForBoost: number;
    /** Hard cap on the funding boost (fraction of the 0–1 score). */
    maxBoost: number;
    /** Known exchange/custodial source wallets excluded entirely. */
    allowlistedSourceWallets: ReadonlyArray<string>;
  };
  /** Activity gate: thin accounts cannot exceed `low`. */
  activityGate: { minMatchedBets: number; minAgeDays: number };
  /** Per-detector alert thresholds (sub-score 0–100, independent of composite). */
  alertThresholds: {
    ring: number;
    wash: number;
    abuse: number;
    velocity: number;
    sybil: number;
  };
  /** Ascending lower-bound → band. */
  bands: ReadonlyArray<{ min: number; band: RiskBand }>;
}

export const RISK_DEFAULTS: RiskConfig = {
  weights: {
    ring: 0.28,
    arbiterConcentration: 0.16,
    concentration: 0.16,
    wash: 0.16,
    abuse: 0.14,
    velocity: 0.1,
  },
  graph: {
    strongEdgeMinBets: 2,
    topCounterparties: 3,
    recentWindowDays: 7,
    baselineWindowDays: 30,
  },
  ring: {
    cohesionWeight: 0.4,
    repeatedCounterpartyWeight: 0.3,
    arbiterOverlapWeight: 0.3,
    minClusterSize: 3,
    minClusterVolumeUsdc: 50,
  },
  arbiterConcentration: {
    creatorShareWeight: 0.35,
    acceptorShareWeight: 0.25,
    clusterShareWeight: 0.4,
    minRuledBets: 5,
  },
  concentration: { hhiFloor: 0.3, minCounterparties: 1 },
  wash: { minRoundTrips: 3, volumeTargetUsdc: 500 },
  abuse: {
    frivolousWeight: 0.45,
    excessWeight: 0.3,
    patternWeight: 0.25,
    smoothing: 3,
    baselineDisputeRate: 0.1,
  },
  velocity: { spikeSaturation: 10, minBaselineBets: 5 },
  funding: {
    saturationUsers: 5,
    minPrimaryForBoost: 0.4,
    maxBoost: 0.05,
    allowlistedSourceWallets: [],
  },
  activityGate: { minMatchedBets: 3, minAgeDays: 3 },
  alertThresholds: { ring: 60, wash: 60, abuse: 60, velocity: 60, sybil: 60 },
  bands: [
    { min: 80, band: 'critical' },
    { min: 60, band: 'high' },
    { min: 40, band: 'elevated' },
    { min: 20, band: 'low' },
    { min: 0, band: 'none' },
  ],
};
