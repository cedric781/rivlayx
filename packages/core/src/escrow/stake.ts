import Decimal from 'decimal.js';
import type { OnchainTransfer } from '@rivlayx/db';
import type { LedgerDb } from '../ledger/types';
import type { TransferInput } from '../payouts/types';
import {
  PolicyViolationError,
  assertTransferAllowed,
  type PrivyTransferPolicy,
} from '../payouts/privy-policy';
import { isValidSolanaAddress, type EscrowConfig } from './config';
import { createTransferRecord } from './transfers';

/**
 * Stake foundation (Phase 3C). Prepares a user→escrow stake: validates the
 * inputs, enforces the policy guard, and creates a `pending` `onchain_transfers`
 * record — then returns a `TransferInput` ready for the Phase 2 provider.
 *
 * It does NOT execute anything: no signer, no RPC, no bet-status change, no
 * ledger write. The submit→finalize step is the future runner (wiring phase).
 * Not wired into `acceptBet`.
 */

export type StakeErrorCode = 'INVALID_WALLET' | 'INVALID_AMOUNT' | 'POLICY_VIOLATION';

export class StakeError extends Error {
  readonly code: StakeErrorCode;
  constructor(code: StakeErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'StakeError';
  }
}

export interface PrepareStakeInput {
  betId: string;
  userId: string;
  /** User's embedded wallet (base58) — the stake source. */
  fromWallet: string;
  amountUsdc: string;
}

export interface PrepareStakeResult {
  transfer: OnchainTransfer;
  /** False when an existing record was returned (idempotent replay). */
  created: boolean;
  /** Provider-ready input — NOT yet submitted. */
  transferInput: TransferInput;
}

export interface PrepareStakeOptions {
  escrowConfig: EscrowConfig;
}

export async function prepareStake(
  db: LedgerDb,
  input: PrepareStakeInput,
  options: PrepareStakeOptions,
): Promise<PrepareStakeResult> {
  const { escrowConfig } = options;

  // ── 1. Validate source wallet ──
  if (!isValidSolanaAddress(input.fromWallet)) {
    throw new StakeError('INVALID_WALLET', `invalid source wallet: ${input.fromWallet}`);
  }

  // ── 2. Validate amount (> 0 and ≤ stake cap) ──
  const amount = new Decimal(input.amountUsdc);
  if (!amount.isFinite() || amount.lte(0)) {
    throw new StakeError('INVALID_AMOUNT', `amount must be > 0 (got ${input.amountUsdc})`);
  }
  if (amount.gt(new Decimal(escrowConfig.maxStakeUsdc))) {
    throw new StakeError(
      'INVALID_AMOUNT',
      `amount ${input.amountUsdc} exceeds per-stake cap ${escrowConfig.maxStakeUsdc}`,
    );
  }

  // ── 3. Policy guard (defense-in-depth: mint, escrow destination, cap) ──
  const policy: PrivyTransferPolicy = {
    usdcMint: escrowConfig.usdcMint,
    allowedDestinations: [escrowConfig.escrowWallet],
    maxAmountUsdc: escrowConfig.maxStakeUsdc,
  };
  try {
    assertTransferAllowed(
      {
        fromWallet: input.fromWallet,
        toWallet: escrowConfig.escrowWallet,
        amountUsdc: input.amountUsdc,
        mint: escrowConfig.usdcMint,
      },
      policy,
    );
  } catch (err) {
    throw new StakeError(
      'POLICY_VIOLATION',
      err instanceof PolicyViolationError ? err.message : String(err),
    );
  }

  // ── 4. Create the pending transfer record (idempotent) ──
  const idempotencyKey = `stake:${input.betId}:${input.userId}`;
  const { transfer, created } = await createTransferRecord(db, {
    type: 'stake',
    userId: input.userId,
    betId: input.betId,
    sourceWallet: input.fromWallet,
    destinationWallet: escrowConfig.escrowWallet,
    amountUsdc: input.amountUsdc,
    mint: escrowConfig.usdcMint,
    caip2: escrowConfig.caip2,
    idempotencyKey,
  });

  // ── 5. Provider-ready input (NOT submitted) ──
  const transferInput: TransferInput = {
    reference: idempotencyKey,
    fromWallet: input.fromWallet,
    toWallet: escrowConfig.escrowWallet,
    amountUsdc: input.amountUsdc,
    betId: input.betId,
  };

  return { transfer, created, transferInput };
}
