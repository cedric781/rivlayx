import Decimal from 'decimal.js';
import type { OnchainTransfer } from '@rivlayx/db';
import type { LedgerDb } from '../ledger/types';
import type { TransferInput } from '../payouts/types';
import { isValidSolanaAddress, type EscrowConfig } from './config';
import { createTransferRecord } from './transfers';
import { transferIdempotencyKey } from './idempotency';

/**
 * Settlement payout foundation (Phase 3D). Prepares an escrow→winner payout:
 * validates the inputs and creates a `pending` `onchain_transfers` record, then
 * returns a `TransferInput` ready for the Phase 2 provider (escrow signs).
 *
 * The destination is DYNAMIC (the winner's embedded wallet), so it cannot sit in
 * a static policy allowlist like a stake does — instead the destination is
 * validated explicitly here, and at settlement-wiring time it will be bound to
 * the settled `winner_user_id`'s embedded wallet. `payout:{betId}` is UNIQUE, so
 * a bet can never produce a second payout.
 *
 * It does NOT execute anything: no signer, no RPC, no bet-status change, no
 * settlement-engine change, no ledger write. Not wired into the settlement engine.
 */

export type PayoutErrorCode = 'INVALID_WALLET' | 'INVALID_AMOUNT';

export class PayoutError extends Error {
  readonly code: PayoutErrorCode;
  constructor(code: PayoutErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'PayoutError';
  }
}

export interface PreparePayoutInput {
  betId: string;
  winnerUserId: string;
  /** Winner's embedded wallet (base58) — the payout destination. */
  winnerWallet: string;
  /** Net payout amount (USDC). */
  amountUsdc: string;
}

export interface PreparePayoutResult {
  transfer: OnchainTransfer;
  /** False when an existing record was returned (idempotent replay). */
  created: boolean;
  /** Provider-ready input — NOT yet submitted. */
  transferInput: TransferInput;
}

export interface PreparePayoutOptions {
  escrowConfig: EscrowConfig;
}

export async function preparePayout(
  db: LedgerDb,
  input: PreparePayoutInput,
  options: PreparePayoutOptions,
): Promise<PreparePayoutResult> {
  const { escrowConfig } = options;

  // ── 1. Validate destination (winner) wallet ──
  if (!isValidSolanaAddress(input.winnerWallet)) {
    throw new PayoutError('INVALID_WALLET', `invalid winner wallet: ${input.winnerWallet}`);
  }
  if (input.winnerWallet === escrowConfig.escrowWallet) {
    throw new PayoutError('INVALID_WALLET', 'payout destination cannot be the escrow wallet');
  }

  // ── 2. Validate amount (> 0 and ≤ payout cap) ──
  const amount = new Decimal(input.amountUsdc);
  if (!amount.isFinite() || amount.lte(0)) {
    throw new PayoutError('INVALID_AMOUNT', `amount must be > 0 (got ${input.amountUsdc})`);
  }
  if (amount.gt(new Decimal(escrowConfig.maxPayoutUsdc))) {
    throw new PayoutError(
      'INVALID_AMOUNT',
      `amount ${input.amountUsdc} exceeds payout cap ${escrowConfig.maxPayoutUsdc}`,
    );
  }

  // ── 3. Create the pending transfer record (idempotent on payout:{betId}) ──
  const idempotencyKey = transferIdempotencyKey.payout(input.betId);
  const { transfer, created } = await createTransferRecord(db, {
    type: 'settlement_payout',
    userId: input.winnerUserId,
    betId: input.betId,
    sourceWallet: escrowConfig.escrowWallet,
    destinationWallet: input.winnerWallet,
    amountUsdc: input.amountUsdc,
    mint: escrowConfig.usdcMint,
    caip2: escrowConfig.caip2,
    idempotencyKey,
  });

  // ── 4. Provider-ready input (NOT submitted) — escrow is the source ──
  const transferInput: TransferInput = {
    reference: idempotencyKey,
    fromWallet: escrowConfig.escrowWallet,
    toWallet: input.winnerWallet,
    amountUsdc: input.amountUsdc,
    betId: input.betId,
  };

  return { transfer, created, transferInput };
}
