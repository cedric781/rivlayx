import * as withdrawals from '@rivlayx/core/withdrawals/cap';

/**
 * Client-safe withdrawal validation (Sprint 30). Split out of `request.ts` so a
 * `'use client'` component can import the pure validator without dragging the
 * server-only DB/ledger graph (postgres → net/tls/fs) into the browser bundle.
 *
 * Pure: no DB, no ledger, no env. Imports only the Decimal-exact cap helpers
 * from `@rivlayx/core/withdrawals/cap` (which depends only on decimal.js).
 */

export type WithdrawalErrorCode =
  | 'INVALID_INPUT'
  | 'FROZEN'
  | 'AMOUNT_EXCEEDS_CAP'
  | 'INSUFFICIENT_BALANCE'
  | 'OPEN_REQUEST_EXISTS'
  | 'NO_WALLET';

/** USDC decimal string, up to 6 places. Mirrors the create-bet stake rule. */
const AMOUNT_RE = /^\d+(\.\d{1,6})?$/;
/** Base58 Solana address, 32..44 chars. */
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export interface ValidateWithdrawalInput {
  amountUsdc: string;
  destinationWallet: string;
  availableUsdc: string;
  withdrawalsFrozen: boolean;
  /**
   * Per-withdrawal cap (USDC). Defaults to the core WITHDRAWAL_LIMITS source so
   * request, approve and runner all enforce one cap; production passes the
   * env-resolved value. This is the request-time guard so a user gets immediate
   * feedback instead of the cap only surfacing later in the admin queue.
   */
  maxWithdrawUsdc?: string;
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
  // Shape first (≤6 decimals, no sign/garbage); the numeric >0 + cap checks are
  // delegated to core so request shares one Decimal-exact cap source.
  if (!AMOUNT_RE.test(amount)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Enter a valid USDC amount.' };
  }
  const maxWithdrawUsdc = input.maxWithdrawUsdc ?? withdrawals.WITHDRAWAL_LIMITS.maxWithdrawUsdc;
  const amountCheck = withdrawals.checkWithdrawalAmount(amount, maxWithdrawUsdc);
  if (!amountCheck.ok) {
    if (amountCheck.code === 'AMOUNT_EXCEEDS_CAP') {
      return {
        ok: false,
        code: 'AMOUNT_EXCEEDS_CAP',
        message: `Amount exceeds the ${maxWithdrawUsdc} USDC per-withdrawal limit.`,
      };
    }
    return { ok: false, code: 'INVALID_INPUT', message: 'Enter a valid USDC amount.' };
  }
  if (!SOLANA_ADDRESS_RE.test(input.destinationWallet.trim())) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Enter a valid Solana wallet address.' };
  }
  if (!withdrawals.coversAmount(input.availableUsdc, amount)) {
    return {
      ok: false,
      code: 'INSUFFICIENT_BALANCE',
      message: `Amount exceeds your available balance (${input.availableUsdc} USDC).`,
    };
  }
  return { ok: true };
}
