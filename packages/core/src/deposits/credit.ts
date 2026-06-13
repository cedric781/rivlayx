import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { deposits, type DepositStatus } from '@rivlayx/db';
import { postLedgerTxn } from '../ledger/post';
import type { LedgerDb } from '../ledger/types';

export type CreditResult =
  | { kind: 'credited'; depositId: string; ledgerTxnId: string }
  | { kind: 'already_credited'; depositId: string; ledgerTxnId: string | null }
  | { kind: 'not_found'; depositId: string }
  | { kind: 'wrong_status'; depositId: string; status: DepositStatus };

/**
 * Credit a confirmed deposit to the user's available balance.
 *
 *   - Idempotent on `deposits.id`: re-running for a 'credited' deposit returns
 *     'already_credited'. The underlying `postLedgerTxn` uses `deposits.id` as
 *     the `requestId`, so even racing callers see an `idempotent_replay`.
 *   - Ledger pattern:
 *       debit  deposit_holding[vault]   amount   (asset ↑)
 *       credit user_available[userId]   amount   (liability ↑)
 *   - Only acts when status='confirmed'. 'pending' returns 'wrong_status' so
 *     the caller knows to run `confirmDeposit` first.
 */
export async function creditDeposit(db: LedgerDb, depositId: string): Promise<CreditResult> {
  const [deposit] = await db.select().from(deposits).where(eq(deposits.id, depositId)).limit(1);

  if (!deposit) return { kind: 'not_found', depositId };

  if (deposit.status === 'credited') {
    return { kind: 'already_credited', depositId, ledgerTxnId: deposit.ledgerTxnId };
  }
  if (deposit.status !== 'confirmed') {
    return { kind: 'wrong_status', depositId, status: deposit.status };
  }

  const txnId = randomUUID();
  const result = await postLedgerTxn(db, {
    txnId,
    requestId: deposit.id, // deposit row is the idempotency boundary
    createdBy: 'deposit-credit',
    entries: [
      {
        accountType: 'deposit_holding',
        accountRef: 'vault',
        direction: 'debit',
        amountUsdc: deposit.amountUsdc,
        reason: 'deposit',
        relatedTxSignature: deposit.txSignature,
      },
      {
        accountType: 'user_available',
        accountRef: deposit.userId,
        direction: 'credit',
        amountUsdc: deposit.amountUsdc,
        reason: 'deposit',
        relatedTxSignature: deposit.txSignature,
      },
    ],
  });

  await db
    .update(deposits)
    .set({
      status: 'credited',
      creditedAt: new Date(),
      ledgerTxnId: result.txnId,
    })
    .where(eq(deposits.id, depositId));

  return { kind: 'credited', depositId, ledgerTxnId: result.txnId };
}
