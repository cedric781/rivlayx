import { randomUUID } from 'node:crypto';
import { postLedgerTxnIn } from '../ledger/post';
import type { LedgerDb } from '../ledger/types';

/**
 * Bet-engine escrow actions. All run inside the caller's transaction via
 * `postLedgerTxnIn` — the bet engine wraps state transitions and escrow
 * movements together so the audit log and ledger move atomically.
 *
 * Naming follows the Sprint 6 spec:
 *   LOCK_STAKE     — `lockStakeForParticipant` (debit user_available, credit bet_escrow)
 *   REFUND_STAKE   — `refundStakeToParticipant` (reverse of lock)
 *   plus the creator-fee variants used by the create / accept / expire flows.
 *
 * RELEASE_STAKE (settlement payout) is intentionally out of scope for Sprint 6.
 */

export interface ParticipantStakeInput {
  betId: string;
  userId: string;
  amountUsdc: string;
  requestId?: string;
}

/**
 * Move `amountUsdc` from a user's `available` into the bet's escrow.
 * Affects the user's `locked_usdc` (credit on a `bet_escrow` row with
 * `affectsUserId=userId`).
 */
export async function lockStakeForParticipant(
  tx: LedgerDb,
  input: ParticipantStakeInput,
): Promise<void> {
  await postLedgerTxnIn(tx, {
    txnId: randomUUID(),
    requestId: input.requestId ?? randomUUID(),
    createdBy: 'bet-engine:lock_stake',
    entries: [
      {
        accountType: 'user_available',
        accountRef: input.userId,
        direction: 'debit',
        amountUsdc: input.amountUsdc,
        reason: 'stake_lock',
        betId: input.betId,
      },
      {
        accountType: 'bet_escrow',
        accountRef: input.betId,
        direction: 'credit',
        amountUsdc: input.amountUsdc,
        reason: 'stake_lock',
        betId: input.betId,
        affectsUserId: input.userId,
      },
    ],
  });
}

/**
 * Reverse a stake lock — used by expire and cancel flows. Equivalent to a
 * standalone refund; the dispute / settlement flows have their own payout
 * functions that are not exposed in Sprint 6.
 */
export async function refundStakeToParticipant(
  tx: LedgerDb,
  input: ParticipantStakeInput,
): Promise<void> {
  await postLedgerTxnIn(tx, {
    txnId: randomUUID(),
    requestId: input.requestId ?? randomUUID(),
    createdBy: 'bet-engine:refund_stake',
    entries: [
      {
        accountType: 'bet_escrow',
        accountRef: input.betId,
        direction: 'debit',
        amountUsdc: input.amountUsdc,
        reason: 'stake_unlock_refund',
        betId: input.betId,
        affectsUserId: input.userId,
      },
      {
        accountType: 'user_available',
        accountRef: input.userId,
        direction: 'credit',
        amountUsdc: input.amountUsdc,
        reason: 'stake_unlock_refund',
        betId: input.betId,
      },
    ],
  });
}

export interface CreatorFeeInput {
  betId: string;
  creatorUserId: string;
  amountUsdc: string;
  requestId?: string;
}

/**
 * On bet creation, lock the creator's anti-spam fee into a per-bet
 * `bet_creation_fee_hold` account. Released to platform on accept, or
 * refunded on expire/cancel.
 */
export async function lockCreationFee(tx: LedgerDb, input: CreatorFeeInput): Promise<void> {
  await postLedgerTxnIn(tx, {
    txnId: randomUUID(),
    requestId: input.requestId ?? randomUUID(),
    createdBy: 'bet-engine:lock_creation_fee',
    entries: [
      {
        accountType: 'user_available',
        accountRef: input.creatorUserId,
        direction: 'debit',
        amountUsdc: input.amountUsdc,
        reason: 'creation_fee_lock',
        betId: input.betId,
      },
      {
        accountType: 'bet_creation_fee_hold',
        accountRef: input.betId,
        direction: 'credit',
        amountUsdc: input.amountUsdc,
        reason: 'creation_fee_lock',
        betId: input.betId,
        affectsUserId: input.creatorUserId,
      },
    ],
  });
}

/**
 * On accept, move the held creation fee from `bet_creation_fee_hold` to
 * `platform_fee` (recognised revenue). The fee is no longer attributable to
 * the creator after this step.
 */
export async function recognizeCreationFee(tx: LedgerDb, input: CreatorFeeInput): Promise<void> {
  await postLedgerTxnIn(tx, {
    txnId: randomUUID(),
    requestId: input.requestId ?? randomUUID(),
    createdBy: 'bet-engine:recognize_creation_fee',
    entries: [
      {
        accountType: 'bet_creation_fee_hold',
        accountRef: input.betId,
        direction: 'debit',
        amountUsdc: input.amountUsdc,
        reason: 'creation_fee_recognize',
        betId: input.betId,
        affectsUserId: input.creatorUserId,
      },
      {
        accountType: 'platform_fee',
        accountRef: 'platform',
        direction: 'credit',
        amountUsdc: input.amountUsdc,
        reason: 'creation_fee_recognize',
        betId: input.betId,
      },
    ],
  });
}

/**
 * On expire or pre-acceptance cancel, refund the held creation fee back to
 * the creator's available balance.
 */
export async function refundCreationFee(tx: LedgerDb, input: CreatorFeeInput): Promise<void> {
  await postLedgerTxnIn(tx, {
    txnId: randomUUID(),
    requestId: input.requestId ?? randomUUID(),
    createdBy: 'bet-engine:refund_creation_fee',
    entries: [
      {
        accountType: 'bet_creation_fee_hold',
        accountRef: input.betId,
        direction: 'debit',
        amountUsdc: input.amountUsdc,
        reason: 'creation_fee_refund',
        betId: input.betId,
        affectsUserId: input.creatorUserId,
      },
      {
        accountType: 'user_available',
        accountRef: input.creatorUserId,
        direction: 'credit',
        amountUsdc: input.amountUsdc,
        reason: 'creation_fee_refund',
        betId: input.betId,
      },
    ],
  });
}
