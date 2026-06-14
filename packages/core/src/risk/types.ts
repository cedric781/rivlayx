import type { RiskAlertType, RiskBand, RiskSubjectType } from '@rivlayx/db';

export type { RiskBand, RiskAlertType, RiskSubjectType };

// ───────────── per-detector pure inputs ─────────────

/** Ring detection input (per user, derived from the counterparty graph). */
export interface RingInput {
  /** Internal edge weight ÷ total incident edge weight, [0,1]. */
  cohesion: number;
  /** Share of matched volume on the user's top-k counterparties, [0,1]. */
  repeatedCounterpartyRatio: number;
  /** Fraction of ruled bets whose arbiter is in the same cluster, [0,1]. */
  arbiterOverlap: number;
  /** Distinct members of the user's cluster (gate). */
  clusterSize: number;
  /** Σ shared volume across the cluster's internal edges (gate). */
  clusterVolumeUsdc: number;
}

/** Arbiter-concentration input. Platform-selected rulings are excluded upstream. */
export interface ArbiterConcentrationInput {
  /** Max share of a creator's bets routed to a single arbiter, [0,1]. */
  creatorArbiterShare: number;
  /** Max share of an acceptor's bets under a single arbiter, [0,1]. */
  acceptorArbiterShare: number;
  /** Max share of a cluster's rulings by a single arbiter, [0,1]. */
  clusterArbiterShare: number;
  /** User-selected ruled bets considered (gate — concentration needs volume). */
  ruledBetsConsidered: number;
}

/** Counterparty-concentration input: settled volume per distinct counterparty. */
export interface ConcentrationInput {
  counterpartyVolumesUsdc: number[];
}

/** Wash-trading input (worst reciprocal pair for the user). */
export interface WashInput {
  /** min(directional matched counts) for the pair — reciprocity strength. */
  roundTrips: number;
  /** |net settled P&L| ÷ gross volume between the pair, [0,1]. */
  netExposureRatio: number;
  /** Reciprocal settled volume (USDC). */
  reciprocalVolumeUsdc: number;
}

/** Dispute-abuse input. */
export interface AbuseInput {
  disputesOpened: number;
  rejectedDisputes: number;
  matchedBets: number;
  /** Share of disputes aimed at the single most-targeted counterparty/arbiter, [0,1]. */
  patternConcentration: number;
}

/** Velocity input: recent window vs trailing baseline. */
export interface VelocityInput {
  recentBets: number;
  baselineBets: number;
  recentVolumeUsdc: number;
  baselineVolumeUsdc: number;
  recentAvgStakeUsdc: number;
  baselineAvgStakeUsdc: number;
  /** False for accounts without enough history — suppresses the signal. */
  hasBaseline: boolean;
}

/** Funding-overlap input (supporting signal only). */
export interface FundingOverlapInput {
  /** Distinct OTHER users sharing a non-allowlisted funding source. */
  sharedSourceUsers: number;
}

/** Behavioural sybil candidate features (no identity/device/IP data). */
export interface SybilInput {
  /** Candidate group size. */
  groupSize: number;
  /** Accounts created within the burst window, [0,1] of the group. */
  creationBurstRatio: number;
  /** Structural username similarity across the group, [0,1]. */
  usernamePatternScore: number;
  /** Repeated identical stake amounts, [0,1]. */
  stakeSimilarity: number;
  /** Repeated identical bet templates/shapes, [0,1]. */
  templateSimilarity: number;
}

export interface SybilResult {
  confidence: number;
  signalsHit: string[];
}

// ───────────── aggregate scoring input/output ─────────────

/** All sub-signals + activity gate. Each `*Signal` is already in [0,1]. */
export interface RiskScoreInput {
  ringSignal: number;
  arbiterConcentrationSignal: number;
  concentrationSignal: number;
  washSignal: number;
  abuseSignal: number;
  velocitySignal: number;
  /** Supporting only — gated + capped in the combiner. */
  fundingSignal: number;
  /** Activity gate: thin accounts cannot exceed `low`. */
  matchedBets: number;
  ageDays: number;
}

export interface RiskSubScores {
  ring: number;
  arbiterConcentration: number;
  concentration: number;
  wash: number;
  abuse: number;
  velocity: number;
  fundingOverlap: number;
}

export interface RiskResult {
  /** 0–100 composite. Advisory only — never triggers an action. */
  riskScore: number;
  band: RiskBand;
  subScores: RiskSubScores;
  /** Primary composite (pre-funding, pre-gate) in [0,1] — for explainability. */
  primary: number;
  /** Funding boost actually applied in [0,0.05]. */
  fundingBoost: number;
  /** True when the activity gate capped the band at `low`. */
  activityGated: boolean;
}
