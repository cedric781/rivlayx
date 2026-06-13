export { BetError, type BetErrorCode } from './errors';
export { BET_ENGINE_DEFAULTS, type BetEngineConfig } from './config';
export { generateShortCode, isValidShortCode } from './short-code';
export { recordBetTransition, type RecordTransitionInput } from './audit';
export {
  lockStakeForParticipant,
  refundStakeToParticipant,
  lockCreationFee,
  recognizeCreationFee,
  refundCreationFee,
  type ParticipantStakeInput,
  type CreatorFeeInput,
} from './escrow';
export {
  validateObjectiveBet,
  containsSubjectivePhrase,
  findSubjectivePhrase,
  predicateSchema,
  predicateKindValues,
  renderPredicate,
  type BetPredicate,
  type PredicateKind,
  type ObjectiveBetInput,
  type ValidatedObjectiveBet,
  type SubjectivePhraseHit,
} from './validation';
export { createBet } from './create';
export { acceptBet } from './accept';
export { expireBet } from './expire';
export { cancelBet } from './cancel';

// Sprint 7 — resolution + disputes + evidence + arbiter
export { transitionToAwaitingResult, proposeResult, closeDisputeWindow, voidBet } from './resolve';

// Sprint 9 — auto-resolve cycle (wired to cron in Sprint 12a)
export {
  resolvePendingBets,
  closeExpiredDisputeWindows,
  runAutoResolveCycle,
  type AutoResolveRunResult,
  type ResolvePendingOptions,
  type CycleResult,
} from './auto-resolve';

// Sprint 10 — settlement engine
export { settleBet, type SettleBetInput, type SettleBetResult } from './settle';
// Sprint 12a — settlement cron cycle
export {
  runSettlementCycle,
  type SettlementCycleOptions,
  type SettlementCycleResult,
} from './settle-cycle';
export { submitEvidence } from './evidence';
export { arbiterAcceptAssignment, arbiterDeclineAssignment, arbiterRule } from './arbiter';
export { openDispute, ruleDispute, withdrawDispute } from './dispute';
export {
  DISPUTE_DEFAULTS,
  DISPUTE_WINDOW_MS,
  computeDisputeDeposit,
  type DisputeConfig,
} from './dispute-config';
export {
  lockDisputeDeposit,
  refundDisputeDeposit,
  forfeitDisputeDeposit,
  type DisputeDepositInput,
} from './dispute-escrow';

export type {
  BetDb,
  CreateBetInput,
  CreateBetResult,
  CreateBetResolveSource,
  AcceptBetInput,
  AcceptBetResult,
  ExpireBetInput,
  ExpireBetResult,
  CancelBetInput,
  CancelBetResult,
  BetEventLogEntry,
  BetAuditEntry,
  TransitionToAwaitingInput,
  TransitionToAwaitingResult,
  ProposeResultInput,
  ProposeResultResult,
  CloseDisputeWindowInput,
  CloseDisputeWindowResult,
  VoidBetInput,
  VoidBetResult,
  SubmitEvidenceInput,
  SubmitEvidenceResult,
  ArbiterAcceptInput,
  ArbiterDeclineInput,
  ArbiterRuleInput,
  ArbiterRuleResult,
  OpenDisputeInput,
  OpenDisputeResult,
  RuleDisputeInput,
  RuleDisputeResult,
  WithdrawDisputeInput,
  WithdrawDisputeResult,
} from './types';
