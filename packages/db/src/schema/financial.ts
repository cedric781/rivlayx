import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './auth';

/**
 * `financial` schema is audit-grade and append-only at the ledger layer.
 * App service role gets INSERT/SELECT on `ledger_entries`; UPDATE/DELETE are
 * revoked at deploy time. Corrections happen via offsetting entries.
 */
export const financialSchema = pgSchema('financial');

// ───────────── value sets ─────────────

export const accountTypeValues = [
  'user_available',
  'bet_escrow',
  'bet_creation_fee_hold',
  'dispute_deposit_hold',
  'platform_fee',
  'deposit_holding',
  'withdrawal_pending',
  'treasury',
] as const;
export type AccountType = (typeof accountTypeValues)[number];

export const directionValues = ['debit', 'credit'] as const;
export type Direction = (typeof directionValues)[number];

export const ledgerReasonValues = [
  'deposit',
  'creation_fee_lock',
  'creation_fee_recognize',
  'creation_fee_refund',
  'stake_lock',
  'stake_unlock_refund',
  'settlement_payout',
  'settlement_fee',
  'dispute_deposit_in',
  'dispute_deposit_refund',
  'dispute_deposit_forfeit',
  'withdrawal_submit',
  'withdrawal_complete',
  'adjustment',
] as const;
export type LedgerReason = (typeof ledgerReasonValues)[number];

export const freezeComponentValues = ['new_bets', 'settlements', 'withdrawals', 'all'] as const;
export type FreezeComponent = (typeof freezeComponentValues)[number];

export const reconciliationStatusValues = ['ok', 'drift', 'halt'] as const;
export type ReconciliationStatus = (typeof reconciliationStatusValues)[number];

/**
 * Liability accounts (user_available, bet_escrow, *_hold, platform_fee, treasury)
 * increase on credit, decrease on debit.
 * Asset accounts (deposit_holding, withdrawal_pending) increase on debit.
 *
 * Every txn_id has at least one debit + one credit and the amounts balance.
 * The (request_id, entry_index) UNIQUE makes the write idempotent: replaying
 * the same request inserts no new rows.
 */
export const ledgerEntries = financialSchema.table(
  'ledger_entries',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    txnId: uuid('txn_id').notNull(),
    /**
     * 0-based slot of this row within the parent txn. Combined with `request_id`
     * it forms the idempotency key — replaying the same request inserts no new
     * rows (the UNIQUE catches it) while allowing multiple entries against the
     * same (direction, account_type, account_ref) within one txn (e.g. settle
     * splits a bet_escrow debit into winner-payout + platform-fee).
     */
    entryIndex: integer('entry_index').notNull(),
    accountType: varchar('account_type', { length: 32, enum: accountTypeValues }).notNull(),
    accountRef: varchar('account_ref', { length: 64 }).notNull(),
    direction: varchar('direction', { length: 8, enum: directionValues }).notNull(),
    amountUsdc: numeric('amount_usdc', { precision: 20, scale: 6 }).notNull(),
    currency: char('currency', { length: 4 }).notNull().default('USDC'),
    betId: uuid('bet_id'),
    relatedTxSignature: varchar('related_tx_signature', { length: 128 }),
    /**
     * For accounts where lock state belongs to a specific user (bet_escrow,
     * bet_creation_fee_hold, dispute_deposit_hold), this carries the user_id
     * whose `balances.locked_usdc` should move. NULL for global accounts.
     * For user_available entries, this is auto-derived from account_ref.
     */
    affectsUserId: uuid('affects_user_id'),
    reason: varchar('reason', { length: 48, enum: ledgerReasonValues }).notNull(),
    requestId: uuid('request_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: varchar('created_by', { length: 64 }).notNull(),
  },
  (t) => ({
    requestEntryUnique: unique('ledger_entries_request_entry_unique').on(t.requestId, t.entryIndex),
    accountIdx: index('ledger_entries_account_idx').on(t.accountType, t.accountRef),
    betIdx: index('ledger_entries_bet_idx').on(t.betId),
    txnIdx: index('ledger_entries_txn_idx').on(t.txnId),
    affectsUserIdx: index('ledger_entries_affects_user_idx').on(t.affectsUserId),
    amountPositive: check('ledger_entries_amount_positive', sql`${t.amountUsdc} > 0`),
  }),
);

/**
 * Denormalised per-user balance projection. Updated atomically inside
 * `postLedgerTxn` whenever a ledger entry affects `user_available` or any
 * locked account. The ledger is the source of truth; this row is a fast read.
 *
 * Reconciliation can recompute the row from the ledger and assert equality.
 */
export const balances = financialSchema.table(
  'balances',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    availableUsdc: numeric('available_usdc', { precision: 20, scale: 6 }).notNull().default('0'),
    lockedUsdc: numeric('locked_usdc', { precision: 20, scale: 6 }).notNull().default('0'),
    refreshedAt: timestamp('refreshed_at', { withTimezone: true }).notNull().defaultNow(),
    version: integer('version').notNull().default(1),
  },
  (t) => ({
    availableNonNegative: check('balances_available_non_negative', sql`${t.availableUsdc} >= 0`),
    lockedNonNegative: check('balances_locked_non_negative', sql`${t.lockedUsdc} >= 0`),
  }),
);

/**
 * Component-level kill switches. Mutations gate on this table at API
 * boundary. `all=true` short-circuits every other component check.
 */
export const freezeState = financialSchema.table('freeze_state', {
  component: varchar('component', { length: 16, enum: freezeComponentValues }).primaryKey(),
  frozen: boolean('frozen').notNull().default(false),
  frozenByUserId: uuid('frozen_by_user_id').references(() => users.id),
  reason: text('reason'),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Reconciliation history. Drift > 0.01 USDC triggers automatic freeze of
 * withdrawals + settlements per the blueprint.
 */
export const reconciliationRuns = financialSchema.table('reconciliation_runs', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
  ledgerTotalUsdc: numeric('ledger_total_usdc', { precision: 24, scale: 6 }),
  onChainTotalUsdc: numeric('on_chain_total_usdc', { precision: 24, scale: 6 }),
  driftUsdc: numeric('drift_usdc', { precision: 24, scale: 6 }),
  status: varchar('status', {
    length: 16,
    enum: reconciliationStatusValues,
  }).notNull(),
  details: jsonb('details'),
});

// ───────────── deposits (Sprint 4) ─────────────

export const depositStatusValues = ['pending', 'confirmed', 'credited', 'rejected'] as const;
export type DepositStatus = (typeof depositStatusValues)[number];

export const depositRejectionReasonValues = [
  'tvl_cap_exceeded',
  'amount_too_small',
  'amount_too_large',
  'wrong_mint',
  'wrong_destination',
  'malformed_tx',
  'tx_failed_on_chain',
  'admin_blocked',
] as const;
export type DepositRejectionReason = (typeof depositRejectionReasonValues)[number];

export const orphanDepositStatusValues = [
  'pending_review',
  'claimed',
  'refunded',
  'abandoned',
] as const;
export type OrphanDepositStatus = (typeof orphanDepositStatusValues)[number];

/**
 * USDC deposits detected on the platform vault ATA, attributed to a known user.
 * Lifecycle: pending → confirmed (finalized) → credited (ledger updated).
 * `rejected` captures cap breaches and malformed events.
 */
export const deposits = financialSchema.table(
  'deposits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    sourceWallet: varchar('source_wallet', { length: 64 }).notNull(),
    txSignature: varchar('tx_signature', { length: 128 }).notNull().unique(),
    amountUsdc: numeric('amount_usdc', { precision: 20, scale: 6 }).notNull(),
    slot: bigint('slot', { mode: 'bigint' }),
    confirmations: integer('confirmations').notNull().default(0),
    status: varchar('status', { length: 16, enum: depositStatusValues })
      .notNull()
      .default('pending'),
    rejectionReason: varchar('rejection_reason', {
      length: 32,
      enum: depositRejectionReasonValues,
    }),
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    creditedAt: timestamp('credited_at', { withTimezone: true }),
    ledgerTxnId: uuid('ledger_txn_id'),
    rawPayload: jsonb('raw_payload'),
  },
  (t) => ({
    userIdx: index('deposits_user_idx').on(t.userId),
    statusIdx: index('deposits_status_idx').on(t.status, t.detectedAt),
    amountPositive: check('deposits_amount_positive', sql`${t.amountUsdc} > 0`),
  }),
);

/**
 * USDC transfers that landed on the vault ATA but came from a wallet not yet
 * linked to any user. Manual resolution path (claim / refund / abandon).
 * NEVER affects user balances directly — has to be claimed first.
 */
export const orphanDeposits = financialSchema.table(
  'orphan_deposits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    txSignature: varchar('tx_signature', { length: 128 }).notNull().unique(),
    sourceWallet: varchar('source_wallet', { length: 64 }).notNull(),
    amountUsdc: numeric('amount_usdc', { precision: 20, scale: 6 }).notNull(),
    slot: bigint('slot', { mode: 'bigint' }),
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
    status: varchar('status', { length: 16, enum: orphanDepositStatusValues })
      .notNull()
      .default('pending_review'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedByUserId: uuid('resolved_by_user_id').references(() => users.id),
    claimedByUserId: uuid('claimed_by_user_id').references(() => users.id),
    resolutionNotes: text('resolution_notes'),
    rawPayload: jsonb('raw_payload'),
  },
  (t) => ({
    statusIdx: index('orphan_deposits_status_idx').on(t.status, t.detectedAt),
    sourceIdx: index('orphan_deposits_source_idx').on(t.sourceWallet),
    amountPositive: check('orphan_deposits_amount_positive', sql`${t.amountUsdc} > 0`),
  }),
);

// ───────────── withdrawal_requests (Sprint 30) ─────────────

export const withdrawalRequestStatusValues = [
  'pending_review',
  'approved',
  'processing',
  'paid',
  'failed',
  'rejected',
  'cancelled',
] as const;
export type WithdrawalRequestStatus = (typeof withdrawalRequestStatusValues)[number];

/**
 * User-initiated USDC withdrawal requests.
 *
 *   Sprint 30: request intake → `pending_review`; admin reviews manually.
 *   Sprint 31: admin `approve` → `approved`, then the withdrawal runner drives
 *     `approved → processing → paid` automatically (on-chain transfer + ledger
 *     debit user_available / credit deposit_holding). Idempotent on the row id;
 *     retryable failures back off, permanent failures land in `failed`.
 *
 * The execution columns below mirror the payouts table so the runner can reuse
 * the same transfer providers, backoff, and idempotency patterns.
 */
export const withdrawalRequests = financialSchema.table(
  'withdrawal_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    amountUsdc: numeric('amount_usdc', { precision: 20, scale: 6 }).notNull(),
    destinationWallet: varchar('destination_wallet', { length: 64 }).notNull(),
    status: varchar('status', { length: 16, enum: withdrawalRequestStatusValues })
      .notNull()
      .default('pending_review'),
    /** Available balance snapshot at request time — audit aid, NOT a hold. */
    availableAtRequestUsdc: numeric('available_at_request_usdc', {
      precision: 20,
      scale: 6,
    }).notNull(),
    reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewNotes: text('review_notes'),
    // ── Sprint 31 automated-execution columns (mirror payouts) ──
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    txSignature: varchar('tx_signature', { length: 128 }),
    ledgerTxnId: uuid('ledger_txn_id'),
    processingAt: timestamp('processing_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('withdrawal_requests_user_idx').on(t.userId, t.createdAt),
    statusIdx: index('withdrawal_requests_status_idx').on(t.status, t.nextAttemptAt),
    amountPositive: check('withdrawal_requests_amount_positive', sql`${t.amountUsdc} > 0`),
  }),
);

// ───────────── inferred types ─────────────

export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type NewLedgerEntry = typeof ledgerEntries.$inferInsert;
export type Balance = typeof balances.$inferSelect;
export type NewBalance = typeof balances.$inferInsert;
export type FreezeStateRow = typeof freezeState.$inferSelect;
export type ReconciliationRun = typeof reconciliationRuns.$inferSelect;
export type Deposit = typeof deposits.$inferSelect;
export type NewDeposit = typeof deposits.$inferInsert;
export type OrphanDeposit = typeof orphanDeposits.$inferSelect;
export type NewOrphanDeposit = typeof orphanDeposits.$inferInsert;
export type WithdrawalRequest = typeof withdrawalRequests.$inferSelect;
export type NewWithdrawalRequest = typeof withdrawalRequests.$inferInsert;
