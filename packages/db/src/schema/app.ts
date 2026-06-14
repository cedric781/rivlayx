import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './auth';

/**
 * `app` schema owns business state: bet templates, bets and everything
 * attached to a bet (participants, rules, arbiters, evidence, events, audit
 * log, share links). Auth lives in `auth`; money in `financial`.
 */
export const appSchema = pgSchema('app');

// ───────────── value sets (Sprint 6) ─────────────

export const betStatusValues = [
  'DRAFT',
  'OPEN',
  'ACTIVE',
  'AWAITING_RESULT',
  'DISPUTED',
  'RESOLVED',
  'SETTLING',
  'SETTLED',
  'PAID',
  'VOID',
  'EXPIRED',
  'CANCELLED',
] as const;
export type BetStatus = (typeof betStatusValues)[number];

export const betTypeValues = ['sports_template', 'open_objective'] as const;
export type BetType = (typeof betTypeValues)[number];

export const resolveTypeValues = ['auto', 'evidence', 'arbiter'] as const;
export type ResolveType = (typeof resolveTypeValues)[number];

export const arbiterTypeValues = ['none', 'user_selected', 'platform_selected'] as const;
export type ArbiterType = (typeof arbiterTypeValues)[number];

export const arbiterAssignmentStatusValues = ['pending', 'accepted', 'declined'] as const;
export type ArbiterAssignmentStatus = (typeof arbiterAssignmentStatusValues)[number];

export const participantRoleValues = ['creator', 'acceptor'] as const;
export type ParticipantRole = (typeof participantRoleValues)[number];

export const betEventTypeValues = [
  'bet_created',
  'bet_opened',
  'bet_accepted',
  'bet_activated',
  'bet_expired',
  'bet_cancelled',
  'bet_voided',
  'bet_disputed',
  'bet_resolved',
  'bet_settling',
  'bet_settled',
  'bet_win',
  'bet_loss',
  'platform_fee',
  'bet_paid',
] as const;
export type BetEventType = (typeof betEventTypeValues)[number];

export const actorTypeValues = ['user', 'system', 'admin'] as const;
export type ActorType = (typeof actorTypeValues)[number];

// ───────────── bet_templates ─────────────

export const betTemplates = appSchema.table('bet_templates', {
  id: varchar('id', { length: 64 }).primaryKey(),
  category: varchar('category', { length: 32 }).notNull(),
  displayName: text('display_name').notNull(),
  description: text('description'),
  /**
   * Predicate kind that this template binds to. Cross-checked against the
   * predicate stored on bets that use this template.
   */
  predicateKind: varchar('predicate_kind', { length: 32 }).notNull(),
  /** Allowed side labels (JSON array of strings) or NULL when free-form. */
  sidesSchema: jsonb('sides_schema'),
  /** Optional default settlement fee (basis points) for bets of this template. */
  defaultSettlementFeeBps: integer('default_settlement_fee_bps').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ───────────── bets ─────────────

export const bets = appSchema.table(
  'bets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shortCode: varchar('short_code', { length: 16 }).notNull().unique(),
    creatorUserId: uuid('creator_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    acceptorUserId: uuid('acceptor_user_id').references(() => users.id, { onDelete: 'restrict' }),

    betType: varchar('bet_type', { length: 24, enum: betTypeValues }).notNull(),
    templateId: varchar('template_id', { length: 64 }).references(() => betTemplates.id),

    title: text('title').notNull(),
    description: text('description'),

    resolveType: varchar('resolve_type', { length: 16, enum: resolveTypeValues }).notNull(),
    /**
     * Resolver-specific configuration:
     *   - auto:     { provider, externalEventId }
     *   - evidence: { spec }
     *   - arbiter:  { arbiterUserId? }  (when user_selected; resolved via bet_arbiters too)
     */
    resolveSource: jsonb('resolve_source').notNull(),

    arbiterType: varchar('arbiter_type', { length: 24, enum: arbiterTypeValues })
      .notNull()
      .default('none'),

    stakePerSideUsdc: numeric('stake_per_side_usdc', { precision: 20, scale: 6 }).notNull(),
    creationFeeUsdc: numeric('creation_fee_usdc', { precision: 20, scale: 6 })
      .notNull()
      .default('0'),
    settlementFeeBps: integer('settlement_fee_bps').notNull(),

    creatorSide: varchar('creator_side', { length: 64 }).notNull(),

    status: varchar('status', { length: 24, enum: betStatusValues }).notNull().default('OPEN'),
    version: integer('version').notNull().default(1),

    expiresAt: timestamp('expires_at', { withTimezone: true }),
    eventAt: timestamp('event_at', { withTimezone: true }),
    evidenceDeadline: timestamp('evidence_deadline', { withTimezone: true }),

    /** Sprint 7 — proposed result + 24h dispute window. */
    proposedWinnerUserId: uuid('proposed_winner_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    proposedOutcome: jsonb('proposed_outcome'),
    proposedAt: timestamp('proposed_at', { withTimezone: true }),
    disputeWindowEndsAt: timestamp('dispute_window_ends_at', { withTimezone: true }),

    /** Sprint 7 — final winner after window closes or dispute ruling. */
    resolvedWinnerUserId: uuid('resolved_winner_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    voidReason: text('void_reason'),

    openedAt: timestamp('opened_at', { withTimezone: true }),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    expiredAt: timestamp('expired_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    voidedAt: timestamp('voided_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusExpiresIdx: index('bets_status_expires_idx').on(t.status, t.expiresAt),
    creatorIdx: index('bets_creator_idx').on(t.creatorUserId),
    acceptorIdx: index('bets_acceptor_idx').on(t.acceptorUserId),
    templateIdx: index('bets_template_idx').on(t.templateId),
    stakePositive: check('bets_stake_positive', sql`${t.stakePerSideUsdc} > 0`),
    creationFeeNonNegative: check('bets_creation_fee_non_negative', sql`${t.creationFeeUsdc} >= 0`),
    settlementFeeNonNegative: check(
      'bets_settlement_fee_non_negative',
      sql`${t.settlementFeeBps} >= 0`,
    ),
  }),
);

// ───────────── bet_participants ─────────────

export const betParticipants = appSchema.table(
  'bet_participants',
  {
    betId: uuid('bet_id')
      .notNull()
      .references(() => bets.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    role: varchar('role', { length: 16, enum: participantRoleValues }).notNull(),
    side: varchar('side', { length: 96 }).notNull(),
    stakeLockedUsdc: numeric('stake_locked_usdc', { precision: 20, scale: 6 }).notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.betId, t.userId] }),
    userIdx: index('bet_participants_user_idx').on(t.userId),
    stakePositive: check('bet_participants_stake_positive', sql`${t.stakeLockedUsdc} > 0`),
  }),
);

// ───────────── bet_rules ─────────────

export const betRules = appSchema.table(
  'bet_rules',
  {
    betId: uuid('bet_id')
      .notNull()
      .references(() => bets.id, { onDelete: 'cascade' }),
    ruleIndex: integer('rule_index').notNull(),
    /**
     * Structured predicate matching one of the predicate kinds in
     * `packages/core/src/bets/validation/predicate-types.ts`. This is the
     * canonical objective rule — free-text title/description must be
     * consistent with it but the predicate is what the resolve engine reads.
     */
    predicate: jsonb('predicate').notNull(),
    /** Human-readable rendering of the predicate (auto-derived). */
    display: text('display').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.betId, t.ruleIndex] }),
  }),
);

// ───────────── bet_arbiters ─────────────

export const betArbiters = appSchema.table(
  'bet_arbiters',
  {
    betId: uuid('bet_id')
      .primaryKey()
      .references(() => bets.id, { onDelete: 'cascade' }),
    arbiterUserId: uuid('arbiter_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    selectedBy: varchar('selected_by', { length: 16 }).notNull(),
    status: varchar('status', {
      length: 16,
      enum: arbiterAssignmentStatusValues,
    })
      .notNull()
      .default('pending'),
    proposedAt: timestamp('proposed_at', { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    /** Sprint 7 — arbiter's structured ruling once `status='accepted'`. */
    decision: jsonb('decision'),
  },
  (t) => ({
    arbiterIdx: index('bet_arbiters_arbiter_idx').on(t.arbiterUserId),
  }),
);

// ───────────── bet_evidence ─────────────
// Upload metadata; resolution wiring lives in `packages/core/src/bets/evidence.ts`.

export const betEvidence = appSchema.table(
  'bet_evidence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    betId: uuid('bet_id')
      .notNull()
      .references(() => bets.id, { onDelete: 'cascade' }),
    uploaderUserId: uuid('uploader_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    storageKey: text('storage_key').notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    contentType: varchar('content_type', { length: 64 }),
    metadata: jsonb('metadata'),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    betIdx: index('bet_evidence_bet_idx').on(t.betId),
    uploaderIdx: index('bet_evidence_uploader_idx').on(t.uploaderUserId),
  }),
);

// ───────────── bet_events ─────────────
// Business-level event feed (used for UI, notifications).

export const betEvents = appSchema.table(
  'bet_events',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    betId: uuid('bet_id')
      .notNull()
      .references(() => bets.id, { onDelete: 'cascade' }),
    eventType: varchar('event_type', { length: 32, enum: betEventTypeValues }).notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
    payload: jsonb('payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    betIdx: index('bet_events_bet_idx').on(t.betId, t.createdAt),
    typeIdx: index('bet_events_type_idx').on(t.eventType),
  }),
);

// ───────────── bet_audit_log ─────────────
// Strict state-transition history (immutable; compliance).

export const betAuditLog = appSchema.table(
  'bet_audit_log',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    betId: uuid('bet_id')
      .notNull()
      .references(() => bets.id, { onDelete: 'cascade' }),
    fromStatus: varchar('from_status', { length: 24, enum: betStatusValues }),
    toStatus: varchar('to_status', { length: 24, enum: betStatusValues }).notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
    actorType: varchar('actor_type', { length: 16, enum: actorTypeValues }).notNull(),
    reason: text('reason'),
    metadata: jsonb('metadata'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    betIdx: index('bet_audit_log_bet_idx').on(t.betId, t.at),
  }),
);

// ───────────── bet_share_links ─────────────

export const betShareLinks = appSchema.table(
  'bet_share_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    betId: uuid('bet_id')
      .notNull()
      .references(() => bets.id, { onDelete: 'cascade' }),
    slug: varchar('slug', { length: 32 }).notNull(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    clicks: integer('clicks').notNull().default(0),
    conversions: integer('conversions').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugUnique: unique('bet_share_links_slug_unique').on(t.slug),
    betIdx: index('bet_share_links_bet_idx').on(t.betId),
  }),
);

// ───────────── disputes (Sprint 7) ─────────────

export const disputeStatusValues = ['open', 'upheld', 'rejected', 'withdrawn'] as const;
export type DisputeStatus = (typeof disputeStatusValues)[number];

export const disputes = appSchema.table(
  'disputes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    betId: uuid('bet_id')
      .notNull()
      .references(() => bets.id, { onDelete: 'cascade' }),
    openerUserId: uuid('opener_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** Which participant the opener claims should win. Must be creator or acceptor. */
    claimedWinnerUserId: uuid('claimed_winner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    reason: text('reason').notNull(),
    depositUsdc: numeric('deposit_usdc', { precision: 20, scale: 6 }).notNull(),
    status: varchar('status', { length: 16, enum: disputeStatusValues }).notNull().default('open'),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    ruledAt: timestamp('ruled_at', { withTimezone: true }),
    ruledByUserId: uuid('ruled_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
    rulingNotes: text('ruling_notes'),
  },
  (t) => ({
    statusIdx: index('disputes_status_idx').on(t.status, t.openedAt),
    openerIdx: index('disputes_opener_idx').on(t.openerUserId),
    betIdx: index('disputes_bet_idx').on(t.betId, t.status),
    depositPositive: check('disputes_deposit_positive', sql`${t.depositUsdc} > 0`),
  }),
);

// ───────────── auto-resolve attempts (Sprint 9) ─────────────

export const autoResolveStatusValues = [
  'final',
  'pending',
  'cancelled',
  'invalid',
  'error',
] as const;
export type AutoResolveStatus = (typeof autoResolveStatusValues)[number];

/**
 * Append-only ledger of every attempt the auto-resolve runner makes for a
 * given bet. `final` records the resolution; `pending` / `cancelled` /
 * `invalid` capture the provider's view that the event is not yet (or never)
 * resolvable; `error` captures unexpected provider failures.
 */
export const autoResolveAttempts = appSchema.table(
  'auto_resolve_attempts',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    betId: uuid('bet_id')
      .notNull()
      .references(() => bets.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 32 }).notNull(),
    status: varchar('status', { length: 16, enum: autoResolveStatusValues }).notNull(),
    errorMessage: text('error_message'),
    /** Raw provider payload, useful for audit + debugging. */
    rawPayload: jsonb('raw_payload'),
    /** Normalized ProviderResult, present when status='final'. */
    outcome: jsonb('outcome'),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    betIdx: index('auto_resolve_attempts_bet_idx').on(t.betId, t.attemptedAt),
    statusIdx: index('auto_resolve_attempts_status_idx').on(t.status, t.attemptedAt),
  }),
);

// ───────────── settlements (Sprint 10) ─────────────
// Ledger-level settlement record for a RESOLVED bet. UNIQUE(bet_id) is the
// double-settle guard; the row is the source of truth for which winner /
// platform_fee ledger txn corresponds to which bet.

export const settlementKindValues = ['winner_payout', 'draw_refund'] as const;
export type SettlementKind = (typeof settlementKindValues)[number];

export const settlements = appSchema.table(
  'settlements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    betId: uuid('bet_id')
      .notNull()
      .references(() => bets.id, { onDelete: 'restrict' }),
    kind: varchar('kind', { length: 16, enum: settlementKindValues }).notNull(),
    /** For 'winner_payout': the winning user. NULL on 'draw_refund'. */
    winnerUserId: uuid('winner_user_id').references(() => users.id, { onDelete: 'restrict' }),
    /** For 'winner_payout': the losing user. NULL on 'draw_refund'. */
    loserUserId: uuid('loser_user_id').references(() => users.id, { onDelete: 'restrict' }),
    /** Gross pot = 2 × stake. */
    potUsdc: numeric('pot_usdc', { precision: 20, scale: 6 }).notNull(),
    /** Gross winner share — pot for 'winner_payout', stake for 'draw_refund'. */
    grossWinnerUsdc: numeric('gross_winner_usdc', { precision: 20, scale: 6 }).notNull(),
    /** Platform fee taken — 0 on 'draw_refund'. */
    platformFeeUsdc: numeric('platform_fee_usdc', { precision: 20, scale: 6 }).notNull(),
    /** Net to winner — gross_winner - platform_fee. */
    netWinnerUsdc: numeric('net_winner_usdc', { precision: 20, scale: 6 }).notNull(),
    /** Pointer to the ledger txn that moved escrow → winner + platform_fee. */
    ledgerTxnId: uuid('ledger_txn_id').notNull(),
    settledAt: timestamp('settled_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    betUnique: unique('settlements_bet_unique').on(t.betId),
    winnerIdx: index('settlements_winner_idx').on(t.winnerUserId),
    feeNonNegative: check('settlements_fee_non_negative', sql`${t.platformFeeUsdc} >= 0`),
    netNonNegative: check('settlements_net_non_negative', sql`${t.netWinnerUsdc} >= 0`),
  }),
);

// ───────────── payouts (Sprint 11) ─────────────
// One row per (settlement, payee). For winner_payout settlements that's
// 1 row (winner); for draw_refund it's 2 rows (creator + acceptor).
// UNIQUE(settlement_id, user_id) is the double-queue guard.

export const payoutStatusValues = [
  'pending',
  'processing',
  'succeeded',
  'failed',
  'cancelled',
] as const;
export type PayoutStatus = (typeof payoutStatusValues)[number];

export const payouts = appSchema.table(
  'payouts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    betId: uuid('bet_id')
      .notNull()
      .references(() => bets.id, { onDelete: 'restrict' }),
    settlementId: uuid('settlement_id')
      .notNull()
      .references(() => settlements.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    amountUsdc: numeric('amount_usdc', { precision: 20, scale: 6 }).notNull(),
    status: varchar('status', { length: 16, enum: payoutStatusValues })
      .notNull()
      .default('pending'),
    destinationWallet: varchar('destination_wallet', { length: 64 }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    txSignature: varchar('tx_signature', { length: 128 }),
    ledgerTxnId: uuid('ledger_txn_id'),
    succeededAt: timestamp('succeeded_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    settlementUserUnique: unique('payouts_settlement_user_unique').on(t.settlementId, t.userId),
    statusIdx: index('payouts_status_idx').on(t.status, t.nextAttemptAt),
    userIdx: index('payouts_user_idx').on(t.userId),
    betIdx: index('payouts_bet_idx').on(t.betId),
    amountPositive: check('payouts_amount_positive', sql`${t.amountUsdc} > 0`),
    attemptsNonNegative: check('payouts_attempts_non_negative', sql`${t.attempts} >= 0`),
  }),
);

export const payoutAttemptStatusValues = [
  'succeeded',
  'failed_retryable',
  'failed_permanent',
] as const;
export type PayoutAttemptStatus = (typeof payoutAttemptStatusValues)[number];

export const payoutAttempts = appSchema.table(
  'payout_attempts',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    payoutId: uuid('payout_id')
      .notNull()
      .references(() => payouts.id, { onDelete: 'cascade' }),
    attemptNumber: integer('attempt_number').notNull(),
    status: varchar('status', { length: 24, enum: payoutAttemptStatusValues }).notNull(),
    txSignature: varchar('tx_signature', { length: 128 }),
    errorMessage: text('error_message'),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    payoutIdx: index('payout_attempts_payout_idx').on(t.payoutId, t.attemptNumber),
    statusIdx: index('payout_attempts_status_idx').on(t.status, t.attemptedAt),
  }),
);

// ───────────── reputation (Sprint 15) ─────────────
// Materialised trust snapshot per user, plus a transactional-outbox queue.
// The money-path (settlement / dispute ruling / moderation) only enqueues a
// refresh; a worker drains the queue and recomputes the snapshot out-of-band.

export const reputationTierValues = [
  'new',
  'untrusted',
  'bronze',
  'silver',
  'gold',
  'trusted',
] as const;
export type ReputationTier = (typeof reputationTierValues)[number];

export const userReputation = appSchema.table('user_reputation', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** 0–100 trust score. Internal — never shown publicly (tier badge only). */
  score: integer('score').notNull().default(0),
  tier: varchar('tier', { length: 16, enum: reputationTierValues }).notNull().default('new'),
  /** When true the public UI shows "New" instead of a tier. */
  provisional: boolean('provisional').notNull().default(true),
  /** Raw signals + sub-scores + winRateAnomaly. Internal (T&S / debug). */
  components: jsonb('components').notNull().default({}),
  // ── arbiter reputation (Sprint 16) — adjudicator trust, same row ──
  /** 0–100 arbiter score. Internal — public surface is the tier badge only. */
  arbiterScore: integer('arbiter_score').notNull().default(0),
  arbiterTier: varchar('arbiter_tier', { length: 16, enum: reputationTierValues })
    .notNull()
    .default('new'),
  arbiterProvisional: boolean('arbiter_provisional').notNull().default(true),
  arbiterRulings: integer('arbiter_rulings').notNull().default(0),
  arbiterOverturnedRate: numeric('arbiter_overturned_rate', { precision: 5, scale: 4 })
    .notNull()
    .default('0'),
  arbiterAcceptanceRate: numeric('arbiter_acceptance_rate', { precision: 5, scale: 4 })
    .notNull()
    .default('0'),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  scoreIdx: index('user_reputation_score_idx').on(t.score),
  tierIdx: index('user_reputation_tier_idx').on(t.tier),
  arbiterScoreIdx: index('user_reputation_arbiter_score_idx').on(t.arbiterScore),
  scoreRange: check('user_reputation_score_range', sql`${t.score} >= 0 AND ${t.score} <= 100`),
  arbiterScoreRange: check(
    'user_reputation_arbiter_score_range',
    sql`${t.arbiterScore} >= 0 AND ${t.arbiterScore} <= 100`,
  ),
}));

export const reputationRefreshReasonValues = [
  'settlement',
  'dispute_ruling',
  'suspension',
  'ban',
  'reinstate',
  'backfill',
  'arbiter_action',
] as const;
export type ReputationRefreshReason = (typeof reputationRefreshReasonValues)[number];

export const reputationRecomputeQueue = appSchema.table(
  'reputation_recompute_queue',
  {
    /** One pending row per user — enqueue upserts on conflict. */
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    reason: varchar('reason', { length: 32, enum: reputationRefreshReasonValues }).notNull(),
    enqueuedAt: timestamp('enqueued_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    enqueuedIdx: index('reputation_queue_enqueued_idx').on(t.enqueuedAt),
  }),
);

// ───────────── risk engine (Sprint 17) — shadow mode, read-only ─────────────
// Observation/detection only. These tables are written exclusively by the risk
// engine; nothing here influences deposits, escrow, settlement or payouts.

export const riskBandValues = ['none', 'low', 'elevated', 'high', 'critical'] as const;
export type RiskBand = (typeof riskBandValues)[number];

export const riskAlertTypeValues = [
  'ring',
  'sybil',
  'wash_trade',
  'dispute_abuse',
  'velocity',
  'high_risk_user',
] as const;
export type RiskAlertType = (typeof riskAlertTypeValues)[number];

export const riskAlertStatusValues = ['open', 'triaged', 'dismissed', 'actioned'] as const;
export type RiskAlertStatus = (typeof riskAlertStatusValues)[number];

export const riskSubjectTypeValues = ['user', 'cluster', 'pair'] as const;
export type RiskSubjectType = (typeof riskSubjectTypeValues)[number];

export const riskRefreshReasonValues = [
  'bet_activity',
  'dispute_activity',
  'deposit_activity',
  'full_sweep',
  'backfill',
] as const;
export type RiskRefreshReason = (typeof riskRefreshReasonValues)[number];

/** Per-user composite risk score + sub-scores. Internal — never public. */
export const riskScores = appSchema.table(
  'risk_scores',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 0–100 composite. Higher = more suspicious. Advisory only. */
    riskScore: integer('risk_score').notNull().default(0),
    riskBand: varchar('risk_band', { length: 16, enum: riskBandValues }).notNull().default('none'),
    ringScore: integer('ring_score').notNull().default(0),
    arbiterConcentrationScore: integer('arbiter_concentration_score').notNull().default(0),
    concentrationScore: integer('concentration_score').notNull().default(0),
    washScore: integer('wash_score').notNull().default(0),
    abuseScore: integer('abuse_score').notNull().default(0),
    velocityScore: integer('velocity_score').notNull().default(0),
    /** Supporting signal only — never a primary factor (capped + gated). */
    fundingOverlapScore: integer('funding_overlap_score').notNull().default(0),
    ringClusterId: uuid('ring_cluster_id'),
    sybilClusterId: uuid('sybil_cluster_id'),
    /** Raw inputs + sub-signals for analyst explainability. */
    components: jsonb('components').notNull().default({}),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    scoreIdx: index('risk_scores_score_idx').on(t.riskScore),
    bandIdx: index('risk_scores_band_idx').on(t.riskBand),
    ringClusterIdx: index('risk_scores_ring_cluster_idx').on(t.ringClusterId),
    scoreRange: check('risk_scores_score_range', sql`${t.riskScore} >= 0 AND ${t.riskScore} <= 100`),
  }),
);

/** Advisory fraud alerts for analyst review. No automatic action. */
export const riskAlerts = appSchema.table(
  'risk_alerts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subjectType: varchar('subject_type', { length: 16, enum: riskSubjectTypeValues }).notNull(),
    /** user_id, cluster_id or canonical pair key. */
    subjectId: text('subject_id').notNull(),
    type: varchar('type', { length: 32, enum: riskAlertTypeValues }).notNull(),
    severity: varchar('severity', { length: 16, enum: riskBandValues }).notNull(),
    score: integer('score').notNull().default(0),
    evidence: jsonb('evidence').notNull().default({}),
    status: varchar('status', { length: 16, enum: riskAlertStatusValues }).notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedByUserId: uuid('resolved_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  (t) => ({
    queueIdx: index('risk_alerts_queue_idx').on(t.status, t.severity, t.createdAt),
    subjectIdx: index('risk_alerts_subject_idx').on(t.subjectType, t.subjectId),
    scoreRange: check('risk_alerts_score_range', sql`${t.score} >= 0 AND ${t.score} <= 100`),
    /** One open alert per (subject, type) — dedup on refresh. */
    openDedup: uniqueIndex('risk_alerts_open_dedup')
      .on(t.subjectType, t.subjectId, t.type)
      .where(sql`${t.status} = 'open'`),
  }),
);

/** Counterparty graph cache (canonical user_a < user_b). Read-only derived. */
export const riskEdges = appSchema.table(
  'risk_edges',
  {
    userA: uuid('user_a')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userB: uuid('user_b')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sharedBets: integer('shared_bets').notNull().default(0),
    sharedVolumeUsdc: numeric('shared_volume_usdc', { precision: 20, scale: 6 })
      .notNull()
      .default('0'),
    sharedArbiterBets: integer('shared_arbiter_bets').notNull().default(0),
    lastBetAt: timestamp('last_bet_at', { withTimezone: true }),
    clusterId: uuid('cluster_id'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userA, t.userB] }),
    userAIdx: index('risk_edges_user_a_idx').on(t.userA),
    userBIdx: index('risk_edges_user_b_idx').on(t.userB),
    clusterIdx: index('risk_edges_cluster_idx').on(t.clusterId),
  }),
);

/** Work queue populated by the scanner (NOT by money-path transactions). */
export const riskRecomputeQueue = appSchema.table(
  'risk_recompute_queue',
  {
    subjectType: varchar('subject_type', { length: 16, enum: riskSubjectTypeValues }).notNull(),
    subjectId: text('subject_id').notNull(),
    reason: varchar('reason', { length: 32, enum: riskRefreshReasonValues }).notNull(),
    enqueuedAt: timestamp('enqueued_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.subjectType, t.subjectId] }),
    enqueuedIdx: index('risk_queue_enqueued_idx').on(t.enqueuedAt),
  }),
);

// ───────────── inferred types ─────────────

export type UserReputation = typeof userReputation.$inferSelect;
export type NewUserReputation = typeof userReputation.$inferInsert;
export type ReputationRecomputeQueueRow = typeof reputationRecomputeQueue.$inferSelect;
export type NewReputationRecomputeQueueRow = typeof reputationRecomputeQueue.$inferInsert;
export type BetTemplate = typeof betTemplates.$inferSelect;
export type NewBetTemplate = typeof betTemplates.$inferInsert;
export type Bet = typeof bets.$inferSelect;
export type NewBet = typeof bets.$inferInsert;
export type BetParticipant = typeof betParticipants.$inferSelect;
export type NewBetParticipant = typeof betParticipants.$inferInsert;
export type BetRule = typeof betRules.$inferSelect;
export type NewBetRule = typeof betRules.$inferInsert;
export type BetArbiter = typeof betArbiters.$inferSelect;
export type NewBetArbiter = typeof betArbiters.$inferInsert;
export type BetEvidence = typeof betEvidence.$inferSelect;
export type NewBetEvidence = typeof betEvidence.$inferInsert;
export type BetEvent = typeof betEvents.$inferSelect;
export type NewBetEvent = typeof betEvents.$inferInsert;
export type BetAuditLog = typeof betAuditLog.$inferSelect;
export type NewBetAuditLog = typeof betAuditLog.$inferInsert;
export type BetShareLink = typeof betShareLinks.$inferSelect;
export type NewBetShareLink = typeof betShareLinks.$inferInsert;
export type Dispute = typeof disputes.$inferSelect;
export type NewDispute = typeof disputes.$inferInsert;
export type AutoResolveAttempt = typeof autoResolveAttempts.$inferSelect;
export type NewAutoResolveAttempt = typeof autoResolveAttempts.$inferInsert;
export type Settlement = typeof settlements.$inferSelect;
export type NewSettlement = typeof settlements.$inferInsert;
export type Payout = typeof payouts.$inferSelect;
export type NewPayout = typeof payouts.$inferInsert;
export type PayoutAttempt = typeof payoutAttempts.$inferSelect;
export type NewPayoutAttempt = typeof payoutAttempts.$inferInsert;
export type RiskScore = typeof riskScores.$inferSelect;
export type NewRiskScore = typeof riskScores.$inferInsert;
export type RiskAlert = typeof riskAlerts.$inferSelect;
export type NewRiskAlert = typeof riskAlerts.$inferInsert;
export type RiskEdge = typeof riskEdges.$inferSelect;
export type NewRiskEdge = typeof riskEdges.$inferInsert;
export type RiskRecomputeQueueRow = typeof riskRecomputeQueue.$inferSelect;
export type NewRiskRecomputeQueueRow = typeof riskRecomputeQueue.$inferInsert;
