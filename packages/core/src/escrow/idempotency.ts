/**
 * Single source of truth for on-chain transfer idempotency keys (Phase 6 —
 * unified idempotency). Every `prepare*` foundation derives the
 * `onchain_transfers.idempotencyKey` (which also becomes the provider
 * `reference`) here, so one logical transfer maps to exactly ONE key.
 *
 * That single key is the basis of single-execution end-to-end:
 *   - the column is UNIQUE; `createTransferRecord` inserts on-conflict-do-nothing
 *     → at most one record per logical transfer;
 *   - the transfer provider is idempotent on the same key (`reference`)
 *     → at most one on-chain execution per logical transfer.
 *
 * The keys are byte-identical to the original inline schemes — this module only
 * de-duplicates their construction so the scheme can never drift between the
 * stake / payout / withdrawal paths.
 */
export const transferIdempotencyKey = {
  /** user → escrow stake. Unique per (bet, user): one stake per user per bet. */
  stake: (betId: string, userId: string): string => `stake:${betId}:${userId}`,
  /** escrow → winner settlement payout. Unique per bet: one payout per bet. */
  payout: (betId: string): string => `payout:${betId}`,
  /** user → external withdrawal. Unique per withdrawal request. */
  withdrawal: (requestId: string): string => `withdrawal:${requestId}`,
} as const;
