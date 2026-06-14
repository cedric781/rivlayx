import type { ReputationTier, UserStatus } from '@rivlayx/db';

export type { ReputationTier };

/** Raw, fraud-resistance-relevant inputs gathered from the DB for one user. */
export interface ReputationSignals {
  distinctCounterparties: number;
  /** Matched bets in SETTLED/PAID (wins + losses + draws). */
  completedBets: number;
  /** Bets the user is in that found an acceptor. */
  matchedBets: number;
  /** Σ per-counterparty-capped settled stake, decimal string. */
  cappedSettledVolumeUsdc: string;
  ageDays: number;
  wins: number;
  losses: number;
  /** Disputes the user opened that were rejected. */
  frivolousDisputes: number;
  /** Upheld disputes that went against the user. */
  adverseDisputes: number;
  status: UserStatus;
}

export interface ReputationSubScores {
  exp: number;
  comp: number;
  vol: number;
  age: number;
  win: number;
}

/** Stored in `user_reputation.components` (internal — T&S / debug only). */
export interface ReputationComponents {
  subScores: ReputationSubScores;
  positive: number;
  integrity: number;
  /** Extreme win-rate over a meaningful sample — surfaced for T&S, no score impact. */
  winRateAnomaly: boolean;
  signals: ReputationSignals;
}

export interface ReputationResult {
  score: number;
  tier: ReputationTier;
  provisional: boolean;
  components: ReputationComponents;
}

/** Public-safe projection used by badges (never includes the numeric score). */
export interface PublicReputation {
  tier: ReputationTier;
  provisional: boolean;
}

// ───────────── arbiter reputation (Sprint 16) ─────────────

/** Raw arbiter signals from `bet_arbiters` + `disputes`. */
export interface ArbiterSignals {
  /** Assignments accepted (status='accepted'). */
  accepted: number;
  /** Assignments declined (status='declined'). */
  declined: number;
  /** Rulings actually made (decision recorded). */
  rulings: number;
  /** Rulings later reversed by an upheld dispute. */
  overturned: number;
  /** Distinct bet creators across ruled bets (anti self-assign farm). */
  distinctCreators: number;
  /** Distinct participants (creators + acceptors) across ruled bets (anti alt farm). */
  distinctParticipants: number;
  /** Ruled bets where the arbiter was platform-selected (vetted → bonus trust). */
  platformRulings: number;
}

export interface ArbiterReputationResult {
  arbiterScore: number;
  arbiterTier: ReputationTier;
  arbiterProvisional: boolean;
  arbiterRulings: number;
  /** 0–1, rounded to 4 decimals. */
  overturnedRate: number;
  /** 0–1, rounded to 4 decimals. */
  acceptanceRate: number;
}
