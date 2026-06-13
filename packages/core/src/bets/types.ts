import type {
  Bet,
  BetParticipant,
  BetRule,
  BetType,
  ResolveType,
  ArbiterType,
  BetEvent,
  BetAuditLog,
  BetEvidence,
  ActorType,
  Dispute,
} from '@rivlayx/db';
import type { BetPredicate, PredicateKind } from './validation';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BetDb = any;

export interface CreateBetResolveSource {
  /** For resolveType='auto': provider + external_event_id. */
  provider?: string;
  externalEventId?: string;
  /** For resolveType='evidence': description of expected evidence. */
  evidenceSpec?: string;
  /** Free-form additional config. */
  extra?: Record<string, unknown>;
}

export interface CreateBetInput {
  creatorUserId: string;
  betType: BetType;
  templateId?: string;
  title: string;
  description?: string;
  predicate: BetPredicate | unknown;

  resolveType: ResolveType;
  resolveSource: CreateBetResolveSource;

  arbiterType: ArbiterType;
  arbiterUserId?: string;

  stakePerSideUsdc: string;
  creationFeeUsdc?: string;
  settlementFeeBps?: number;

  creatorSide: string;
  /** ISO datetime — when OPEN expires if no one accepts. */
  expiresAt: string;
  /** Optional event time (auto-resolve) or evidence deadline anchor. */
  eventAt?: string;
  /** For evidence-resolve bets. */
  evidenceDeadline?: string;
}

export interface CreateBetResult {
  bet: Bet;
  rule: BetRule;
  creatorParticipant: BetParticipant;
  shareSlug: string;
}

export interface AcceptBetInput {
  betId: string;
  acceptorUserId: string;
  /** Side label the acceptor chooses; must differ from creator's. */
  acceptorSide: string;
}

export interface AcceptBetResult {
  bet: Bet;
  acceptorParticipant: BetParticipant;
}

export interface ExpireBetInput {
  betId: string;
  /** When undefined: "system" (cron). */
  actorUserId?: string;
}

export interface ExpireBetResult {
  kind: 'expired' | 'not_expirable';
  bet?: Bet;
  reason?: string;
}

export interface CancelBetInput {
  betId: string;
  actorUserId: string;
  reason?: string;
}

export interface CancelBetResult {
  bet: Bet;
}

export interface TransitionToAwaitingInput {
  betId: string;
  /** undefined → system actor (cron). */
  actorUserId?: string;
  reason?: string;
}
export type TransitionToAwaitingResult =
  | { kind: 'transitioned'; bet: Bet }
  | { kind: 'noop'; reason: string };

export interface ProposeResultInput {
  betId: string;
  proposedWinnerUserId: string;
  proposedOutcome?: Record<string, unknown> | null;
  actorUserId?: string | null;
  actorType: ActorType;
  reason?: string;
}
export interface ProposeResultResult {
  bet: Bet;
  proposedAt: Date;
  disputeWindowEndsAt: Date;
}

export interface CloseDisputeWindowInput {
  betId: string;
}
export type CloseDisputeWindowResult =
  | { kind: 'resolved'; bet: Bet }
  | { kind: 'noop'; reason: string };

export interface VoidBetInput {
  betId: string;
  actorUserId: string;
  reason: string;
}
export interface VoidBetResult {
  bet: Bet;
}

export interface SubmitEvidenceInput {
  betId: string;
  uploaderUserId: string;
  storageKey: string;
  sha256: string;
  contentType?: string;
  metadata?: Record<string, unknown>;
}
export interface SubmitEvidenceResult {
  evidence: BetEvidence;
}

export interface ArbiterAcceptInput {
  betId: string;
  arbiterUserId: string;
}
export interface ArbiterDeclineInput {
  betId: string;
  arbiterUserId: string;
  reason?: string;
}
export interface ArbiterRuleInput {
  betId: string;
  arbiterUserId: string;
  /** The participant the arbiter rules in favour of. */
  winnerUserId: string;
  /** Arbiter's structured decision payload (notes, evidence references, etc.). */
  decision: Record<string, unknown>;
}
export interface ArbiterRuleResult {
  bet: Bet;
  proposedAt: Date;
  disputeWindowEndsAt: Date;
}

export interface OpenDisputeInput {
  betId: string;
  openerUserId: string;
  /** Who the opener thinks should actually win. Must be creator or acceptor. */
  claimedWinnerUserId: string;
  reason: string;
}
export interface OpenDisputeResult {
  dispute: Dispute;
  bet: Bet;
  depositUsdc: string;
}

export interface RuleDisputeInput {
  disputeId: string;
  adminUserId: string;
  ruling: 'uphold' | 'reject';
  /** Override winner when uphold (defaults to dispute.claimedWinnerUserId). */
  winnerUserIdOverride?: string;
  notes?: string;
}
export interface RuleDisputeResult {
  dispute: Dispute;
  bet: Bet;
}

export interface WithdrawDisputeInput {
  disputeId: string;
  openerUserId: string;
  notes?: string;
}
export interface WithdrawDisputeResult {
  dispute: Dispute;
  bet: Bet;
}

export type BetEventLogEntry = BetEvent;
export type BetAuditEntry = BetAuditLog;
export type { BetPredicate, PredicateKind };
