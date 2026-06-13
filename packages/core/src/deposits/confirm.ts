import { eq } from 'drizzle-orm';
import { deposits, type DepositStatus } from '@rivlayx/db';
import type { IHeliusRpc } from '@rivlayx/helius';
import type { LedgerDb } from '../ledger/types';
import { REQUIRED_CONFIRMATIONS } from './config';

export type ConfirmResult =
  | { kind: 'confirmed'; depositId: string; confirmations: number }
  | { kind: 'still_pending'; depositId: string; confirmations: number }
  | { kind: 'tx_failed'; depositId: string; error: string }
  | { kind: 'not_found'; depositId: string }
  | { kind: 'wrong_status'; depositId: string; status: DepositStatus };

/**
 * Walk a pending deposit toward `confirmed` by re-checking finality on chain.
 *
 *   - Status not 'pending'              → no-op, returns 'wrong_status'.
 *   - RPC has no record yet             → 'still_pending'.
 *   - RPC reports tx error              → marks deposit 'rejected', reason
 *                                          'tx_failed_on_chain'.
 *   - confirmationStatus = 'finalized'  → status='confirmed', confirmed_at set.
 *   - confirmations < REQUIRED          → 'still_pending', confirmations updated.
 *   - confirmations ≥ REQUIRED          → status='confirmed'.
 *
 * Pure orchestration; the RPC is injected for testability.
 */
export async function confirmDeposit(
  db: LedgerDb,
  rpc: IHeliusRpc,
  depositId: string,
): Promise<ConfirmResult> {
  const [deposit] = await db.select().from(deposits).where(eq(deposits.id, depositId)).limit(1);

  if (!deposit) return { kind: 'not_found', depositId };
  if (deposit.status !== 'pending') {
    return { kind: 'wrong_status', depositId, status: deposit.status };
  }

  const status = await rpc.getSignatureStatus(deposit.txSignature);
  if (!status) {
    return { kind: 'still_pending', depositId, confirmations: 0 };
  }

  if (status.err) {
    await db
      .update(deposits)
      .set({ status: 'rejected', rejectionReason: 'tx_failed_on_chain' })
      .where(eq(deposits.id, depositId));
    return { kind: 'tx_failed', depositId, error: JSON.stringify(status.err) };
  }

  const finalized =
    status.confirmationStatus === 'finalized' ||
    (status.confirmations !== null && status.confirmations >= REQUIRED_CONFIRMATIONS);

  if (!finalized) {
    const conf = status.confirmations ?? 0;
    await db.update(deposits).set({ confirmations: conf }).where(eq(deposits.id, depositId));
    return { kind: 'still_pending', depositId, confirmations: conf };
  }

  const conf = status.confirmations ?? REQUIRED_CONFIRMATIONS;
  await db
    .update(deposits)
    .set({ status: 'confirmed', confirmations: conf, confirmedAt: new Date() })
    .where(eq(deposits.id, depositId));
  return { kind: 'confirmed', depositId, confirmations: conf };
}
