import { and, eq, inArray } from 'drizzle-orm';
import { ledger } from '@rivlayx/core';
import { withdrawalRequests, type WithdrawalRequest } from '@rivlayx/db';

/**
 * Withdrawal REQUEST intake (Sprint 30). Records a user's intent to withdraw
 * USDC to a wallet. It does NOT move money, NOT touch the ledger, NOT enqueue a
 * payout — an admin reviews and fulfils `pending_review` requests out-of-band.
 *
 * Balance is checked at request time (snapshot stored for audit); the admin
 * must re-check available balance at fulfilment since nothing is held here.
 */

export type WithdrawalErrorCode =
  | 'INVALID_INPUT'
  | 'FROZEN'
  | 'AMOUNT_EXCEEDS_CAP'
  | 'INSUFFICIENT_BALANCE'
  | 'OPEN_REQUEST_EXISTS'
  | 'NO_WALLET';

export class WithdrawalError extends Error {
  constructor(
    readonly code: WithdrawalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WithdrawalError';
  }
}

/** USDC decimal string, up to 6 places. Mirrors the create-bet stake rule. */
const AMOUNT_RE = /^\d+(\.\d{1,6})?$/;
/** Base58 Solana address, 32..44 chars. */
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/**
 * Per-withdrawal hard cap, USDC. Mirrors `@rivlayx/core` WITHDRAWAL_LIMITS
 * .maxWithdrawUsdc — which stays authoritative at approve + payout time. This
 * is the request-time guard so a user gets immediate feedback instead of the
 * cap only surfacing later in the admin queue.
 */
const MAX_WITHDRAW_USDC = '25';

export interface ValidateWithdrawalInput {
  amountUsdc: string;
  destinationWallet: string;
  availableUsdc: string;
  withdrawalsFrozen: boolean;
}

export type ValidateResult = { ok: true } | { ok: false; code: WithdrawalErrorCode; message: string };

/**
 * Pure validation — no DB. Order matters: a freeze stops everything first, then
 * shape, then funds. Kept separate so it is unit-testable without a database.
 */
export function validateWithdrawalInput(input: ValidateWithdrawalInput): ValidateResult {
  if (input.withdrawalsFrozen) {
    return { ok: false, code: 'FROZEN', message: 'Withdrawals are temporarily paused.' };
  }
  const amount = input.amountUsdc.trim();
  if (!AMOUNT_RE.test(amount) || Number(amount) <= 0) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Enter a valid USDC amount.' };
  }
  if (Number(amount) > Number(MAX_WITHDRAW_USDC)) {
    return {
      ok: false,
      code: 'AMOUNT_EXCEEDS_CAP',
      message: `Amount exceeds the ${MAX_WITHDRAW_USDC} USDC per-withdrawal limit.`,
    };
  }
  if (!SOLANA_ADDRESS_RE.test(input.destinationWallet.trim())) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Enter a valid Solana wallet address.' };
  }
  if (Number(amount) > Number(input.availableUsdc)) {
    return {
      ok: false,
      code: 'INSUFFICIENT_BALANCE',
      message: `Amount exceeds your available balance (${input.availableUsdc} USDC).`,
    };
  }
  return { ok: true };
}

export interface RequestWithdrawalInput {
  userId: string;
  amountUsdc: string;
  destinationWallet: string;
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
