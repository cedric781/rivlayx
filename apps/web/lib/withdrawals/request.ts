import { and, eq, inArray } from 'drizzle-orm';
import { ledger } from '@rivlayx/core';
import { withdrawalRequests, type WithdrawalRequest } from '@rivlayx/db';
import {
  validateWithdrawalInput,
  type WithdrawalErrorCode,
  type ValidateWithdrawalInput,
  type ValidateResult,
} from './validate';

/**
 * Withdrawal REQUEST intake (Sprint 30). Records a user's intent to withdraw
 * USDC to a wallet. It does NOT move money, NOT touch the ledger, NOT enqueue a
 * payout — an admin reviews and fulfils `pending_review` requests out-of-band.
 *
 * Balance is checked at request time (snapshot stored for audit); the admin
 * must re-check available balance at fulfilment since nothing is held here.
 *
 * The pure, client-safe validator + its types live in `./validate` so the
 * withdraw form can import them without pulling the DB/ledger graph into the
 * browser bundle. They are re-exported here for back-compat.
 */

export {
  validateWithdrawalInput,
  type WithdrawalErrorCode,
  type ValidateWithdrawalInput,
  type ValidateResult,
};

export class WithdrawalError extends Error {
  constructor(
    readonly code: WithdrawalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WithdrawalError';
  }
}

export interface RequestWithdrawalInput {
  userId: string;
  amountUsdc: string;
  destinationWallet: string;
  /**
   * Per-withdrawal cap (USDC). The HTTP route resolves this from env via
   * `getWithdrawalLimits()`; when omitted (tests/dev) it defaults to the core
   * WITHDRAWAL_LIMITS source. Kept as a param so this layer reads no env.
   */
  maxWithdrawUsdc?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/**
 * Run the freeze + balance checks against live state and, if they pass, persist
 * a `pending_review` withdrawal request. Throws `WithdrawalError` on failure.
 */
export async function requestWithdrawal(
  db: Db,
  input: RequestWithdrawalInput,
): Promise<WithdrawalRequest> {
  // isFrozen('withdrawals') already returns true when the global 'all' freeze is on.
  const withdrawalsFrozen = await ledger.isFrozen(db, 'withdrawals');
  const balance = await ledger.getBalance(db, input.userId);
  const availableUsdc = balance?.availableUsdc ?? '0';

  const check = validateWithdrawalInput({
    amountUsdc: input.amountUsdc,
    destinationWallet: input.destinationWallet,
    availableUsdc,
    withdrawalsFrozen,
    maxWithdrawUsdc: input.maxWithdrawUsdc,
  });
  if (!check.ok) throw new WithdrawalError(check.code, check.message);

  // One open withdrawal at a time: block while a prior request is still
  // pending_review, approved, or processing (terminal states do not count).
  const open = await db
    .select({ id: withdrawalRequests.id })
    .from(withdrawalRequests)
    .where(
      and(
        eq(withdrawalRequests.userId, input.userId),
        inArray(withdrawalRequests.status, ['pending_review', 'approved', 'processing']),
      ),
    )
    .limit(1);
  if (open[0]) {
    throw new WithdrawalError(
      'OPEN_REQUEST_EXISTS',
      'You already have a withdrawal in progress. Wait for it to be reviewed before requesting another.',
    );
  }

  const [row] = await db
    .insert(withdrawalRequests)
    .values({
      userId: input.userId,
      amountUsdc: input.amountUsdc.trim(),
      destinationWallet: input.destinationWallet.trim(),
      status: 'pending_review',
      availableAtRequestUsdc: availableUsdc,
    })
    .returning();
  return row;
}
