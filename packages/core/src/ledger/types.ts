import type { AccountType, Direction, LedgerReason } from '@rivlayx/db';

/**
 * Loose Drizzle handle covering both the production postgres-js driver and
 * the pglite test driver. Both extend `PgDatabase` with compatible query
 * builders; the `any` here avoids the higher-kinded generic noise that
 * differs between drivers.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LedgerDb = any;

export interface LedgerEntryInput {
  accountType: AccountType;
  accountRef: string;
  direction: Direction;
  /** Decimal string with up to 6 fractional digits (USDC has 6 decimals). */
  amountUsdc: string;
  reason: LedgerReason;
  betId?: string | null;
  relatedTxSignature?: string | null;
  /**
   * Required for locked-account entries (`bet_escrow`,
   * `bet_creation_fee_hold`, `dispute_deposit_hold`) — identifies the user
   * whose `balances.locked_usdc` should move. For `user_available` entries
   * it must equal `accountRef` when supplied. Ignored on global accounts.
   */
  affectsUserId?: string | null;
}

export interface PostLedgerTxnInput {
  txnId: string;
  requestId: string;
  createdBy: string;
  entries: LedgerEntryInput[];
}

export type PostLedgerStatus = 'posted' | 'idempotent_replay';

export interface PostLedgerResult {
  status: PostLedgerStatus;
  txnId: string;
  entryCount: number;
}
