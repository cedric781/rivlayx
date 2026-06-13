import { randomUUID } from 'node:crypto';
import { postLedgerTxnIn } from '../ledger/post';
import type { LedgerDb } from '../ledger/types';

/**
 * Dispute deposit ledger ops. Mirrors the stake-escrow pattern but uses the
 * `dispute_deposit_hold` account type so reconciliation can isolate it.
 *
 *   LOCK_DISPUTE_DEPOSIT      opener pays it → held against the bet
 *   REFUND_DISPUTE_DEPOSIT    dispute upheld OR withdrawn → opener gets it back
 *   FORFEIT_DISPUTE_DEPOSIT   dispute rejected → goes to platform_fee
 *
 * All three are invoked inside the calling transaction so they atomically
 * commit with the dispute state change.
 */

export interface DisputeDepositInput {
  betId: string;
  openerUserId: string;
  amountUsdc: string;
  requestId?: string;
}

export async function lockDisputeDeposit(tx: LedgerDb, input: DisputeDepositInput): Promise<void> {
  await postLedgerTxnIn(tx, {
    txnId: randomUUID(),
    requestId: input.requestId ?? randomUUID(),
    createdBy: 'bet-engine:lock_dispute_deposit',
    entries: [
      {
        accountType: 'user_available',
        accountRef: input.openerUserId,
        direction: 'debit',
        amountUsdc: input.amountUsdc,
        reason: 'dispute_deposit_in',
        betId: input.betId,
      },
      {
        accountType: 'dispute_deposit_hold',
        accountRef: input.betId,
        direction: 'credit',
        amountUsdc: input.amountUsdc,
        reason: 'dispute_deposit_in',
        betId: input.betId,
        affectsUserId: input.openerUserId,
      },
    ],
  });
}

export async function refundDisputeDeposit(
  tx: LedgerDb,
  input: DisputeDepositInput,
): Promise<void> {
  await postLedgerTxnIn(tx, {
    txnId: randomUUID(),
    requestId: input.requestId ?? randomUUID(),
    createdBy: 'bet-engine:refund_dispute_deposit',
    entries: [
      {
        accountType: 'dispute_deposit_hold',
        accountRef: input.betId,
        direction: 'debit',
        amountUsdc: input.amountUsdc,
        reason: 'dispute_deposit_refund',
        betId: input.betId,
        affectsUserId: input.openerUserId,
      },
      {
        accountType: 'user_available',
        accountRef: input.openerUserId,
        direction: 'credit',
        amountUsdc: input.amountUsdc,
        reason: 'dispute_deposit_refund',
        betId: input.betId,
      },
    ],
  });
}

export async function forfeitDisputeDeposit(
  tx: LedgerDb,
  input: DisputeDepositInput,
): Promise<void> {
  await postLedgerTxnIn(tx, {
    txnId: randomUUID(),
    requestId: input.requestId ?? randomUUID(),
    createdBy: 'bet-engine:forfeit_dispute_deposit',
    entries: [
      {
        accountType: 'dispute_deposit_hold',
        accountRef: input.betId,
        direction: 'debit',
        amountUsdc: input.amountUsdc,
        reason: 'dispute_deposit_forfeit',
        betId: input.betId,
        affectsUserId: input.openerUserId,
      },
      {
        accountType: 'platform_fee',
        accountRef: 'platform',
        direction: 'credit',
        amountUsdc: input.amountUsdc,
        reason: 'dispute_deposit_forfeit',
        betId: input.betId,
      },
    ],
  });
}
