import Decimal from 'decimal.js';
import type { OnchainTransfer } from '@rivlayx/db';
import type { LedgerDb } from '../ledger/types';
import type { TransferInput } from '../payouts/types';
import { WITHDRAWAL_LIMITS } from '../withdrawals/cap';
import { isValidSolanaAddress, type EscrowConfig } from './config';
import { createTransferRecord } from './transfers';
import { transferIdempotencyKey } from './idempotency';

/**
 * Withdrawal payout foundation (Phase 3D). Prepares a user→external withdrawal:
 * validates the inputs and creates a `pending` `onchain_transfers` record, then
 * returns a `TransferInput` ready for the Phase 2 provider (the user's embedded
 * wallet signs from `fromWallet`).
 *
 * Both wallets are DYNAMIC: `fromWallet` is the withdrawing user's embedded
 * wallet and `destinationWallet` is an arbitrary external address, so neither
 * sits in a static policy allowlist — both are validated explicitly here. The
 * destination may not be the escrow wallet (that would be an internal move, not
 * a withdrawal) nor `fromWallet` (a self-transfer is a no-op). `withdrawal:
 * {requestId}` is UNIQUE, so a request can never produce a second transfer.
 *
 * It does NOT execute anything: no signer, no RPC, no withdrawal-request status
 * change, no withdrawal-runner change, no ledger write. Not wired into the
 * withdrawal runner.
 */

export type WithdrawErrorCode = 'INVALID_WALLET' | 'INVALID_AMOUNT';

export class WithdrawError extends Error {
  readonly code: WithdrawErrorCode;
  constructor(code: WithdrawErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'WithdrawError';
  }
}

export interface PrepareWithdrawalInput {
  /** Withdrawal-request id — the idempotency anchor. */
  requestId: string;
  userId: string;
  /** Withdrawing user's embedded wallet (base58) — the source. */
  fromWallet: string;
  /** External destination wallet (base58). */
  destinationWallet: string;
  /** Withdrawal amount (USDC). */
  amountUsdc: string;
}

export interface PrepareWithdrawalResult {
  transfer: OnchainTransfer;
  /** False when an existing record was returned (idempotent replay). */
  created: boolean;
  /** Provider-ready input — NOT yet submitted. */
  transferInput: TransferInput;
}

export interface PrepareWithdrawalOptions {
  escrowConfig: EscrowConfig;
  /** Per-request withdrawal cap (USDC). Defaults to the canonical cap. */
  maxWithdrawUsdc?: string;
}

export async function prepareWithdrawal(
  db: LedgerDb,
  input: PrepareWithdrawalInput,
  options: PrepareWithdrawalOptions,
): Promise<PrepareWithdrawalResult> {
  const { escrowConfig } = options;
  const maxWithdrawUsdc = options.maxWithdrawUsdc ?? WITHDRAWAL_LIMITS.maxWithdrawUsdc;

  // ── 1. Validate source (user) wallet ──
  if (!isValidSolanaAddress(input.fromWallet)) {
    throw new WithdrawError('INVALID_WALLET', `invalid source wallet: ${input.fromWallet}`);
  }

  // ── 2. Validate destination (external) wallet ──
  if (!isValidSolanaAddress(input.destinationWallet)) {
    throw new WithdrawError('INVALID_WALLET', `invalid destination wallet: ${input.destinationWallet}`);
  }
  if (input.destinationWallet === escrowConfig.escrowWallet) {
    throw new WithdrawError('INVALID_WALLET', 'withdrawal destination cannot be the escrow wallet');
  }
  if (input.destinationWallet === input.fromWallet) {
    throw new WithdrawError('INVALID_WALLET', 'withdrawal destination cannot be the source wallet');
  }

  // ── 3. Validate amount (> 0 and ≤ withdrawal cap) ──
  const amount = new Decimal(input.amountUsdc);
  if (!amount.isFinite() || amount.lte(0)) {
    throw new WithdrawError('INVALID_AMOUNT', `amount must be > 0 (got ${input.amountUsdc})`);
  }
  if (amount.gt(new Decimal(maxWithdrawUsdc))) {
    throw new WithdrawError(
      'INVALID_AMOUNT',
      `amount ${input.amountUsdc} exceeds withdrawal cap ${maxWithdrawUsdc}`,
    );
  }

  // ── 4. Create the pending transfer record (idempotent on withdrawal:{requestId}) ──
  const idempotencyKey = transferIdempotencyKey.withdrawal(input.requestId);
  const { transfer, created } = await createTransferRecord(db, {
    type: 'withdrawal',
    userId: input.userId,
    betId: null,
    sourceWallet: input.fromWallet,
    destinationWallet: input.destinationWallet,
    amountUsdc: input.amountUsdc,
    mint: escrowConfig.usdcMint,
    caip2: escrowConfig.caip2,
    idempotencyKey,
  });

  // ── 5. Provider-ready input (NOT submitted) — user wallet is the source ──
  const transferInput: TransferInput = {
    reference: idempotencyKey,
    fromWallet: input.fromWallet,
    toWallet: input.destinationWallet,
    amountUsdc: input.amountUsdc,
    betId: input.requestId, // no bet for a withdrawal; requestId doubles as the trace ref
  };

  return { transfer, created, transferInput };
}
