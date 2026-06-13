import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { and, eq } from 'drizzle-orm';
import {
  deposits,
  orphanDeposits,
  wallets,
  type DepositRejectionReason,
  type NewDeposit,
  type NewOrphanDeposit,
} from '@rivlayx/db';
import type { ParsedTransfer } from '@rivlayx/helius';
import type { LedgerDb } from '../ledger/types';
import { wouldExceedTvlCap } from './tvl';
import type { DepositConfig } from './config';

export type DetectResult =
  | { kind: 'deposit'; depositId: string; status: 'pending' }
  | { kind: 'deposit_rejected'; depositId: string; reason: DepositRejectionReason }
  | { kind: 'orphan'; orphanId: string }
  | { kind: 'duplicate'; txSignature: string; existingTable: 'deposits' | 'orphan_deposits' };

/**
 * Classify and persist a parsed Solana token transfer.
 *
 *   - tx_signature already seen → 'duplicate', no writes
 *   - source wallet not linked to any user → 'orphan' row, no balance change
 *   - known user + amount out of bounds → 'deposit_rejected' (status='rejected'),
 *     no balance change
 *   - known user + cap headroom OK → 'deposit' with status='pending', awaits
 *     finality before credit
 *
 * Does NOT touch the ledger. Crediting happens later via `creditDeposit`.
 */
export async function detectDeposit(
  db: LedgerDb,
  transfer: ParsedTransfer,
  config: DepositConfig,
  rawPayload?: unknown,
): Promise<DetectResult> {
  // 1. Dedup against deposits table.
  const dupDeposit = await db
    .select({ txSignature: deposits.txSignature })
    .from(deposits)
    .where(eq(deposits.txSignature, transfer.signature))
    .limit(1);
  if (dupDeposit[0]) {
    return {
      kind: 'duplicate',
      txSignature: dupDeposit[0].txSignature,
      existingTable: 'deposits',
    };
  }

  // 2. Dedup against orphan_deposits table.
  const dupOrphan = await db
    .select({ txSignature: orphanDeposits.txSignature })
    .from(orphanDeposits)
    .where(eq(orphanDeposits.txSignature, transfer.signature))
    .limit(1);
  if (dupOrphan[0]) {
    return {
      kind: 'duplicate',
      txSignature: dupOrphan[0].txSignature,
      existingTable: 'orphan_deposits',
    };
  }

  const amount = new Decimal(transfer.amountUsdc);

  // 3. Lookup user by source wallet (solana chain, primary or otherwise).
  const [walletRow] = await db
    .select({ userId: wallets.userId })
    .from(wallets)
    .where(and(eq(wallets.address, transfer.sourceWallet), eq(wallets.chain, 'solana')))
    .limit(1);

  if (!walletRow) {
    // Orphan path.
    const id = randomUUID();
    const newOrphan: NewOrphanDeposit = {
      id,
      txSignature: transfer.signature,
      sourceWallet: transfer.sourceWallet,
      amountUsdc: amount.toFixed(6),
      slot: BigInt(transfer.slot),
      status: 'pending_review',
      rawPayload: rawPayload ?? null,
    };
    await db.insert(orphanDeposits).values(newOrphan);
    return { kind: 'orphan', orphanId: id };
  }

  // 4. Known user: amount + TVL checks.
  let rejection: DepositRejectionReason | null = null;

  if (amount.lt(new Decimal(config.minDepositUsdc))) {
    rejection = 'amount_too_small';
  } else if (amount.gt(new Decimal(config.maxSingleDepositUsdc))) {
    rejection = 'amount_too_large';
  } else {
    const tvl = await wouldExceedTvlCap(db, amount.toFixed(6), config.maxTvlUsdc);
    if (tvl.exceeds) rejection = 'tvl_cap_exceeded';
  }

  const id = randomUUID();
  const newDeposit: NewDeposit = {
    id,
    userId: walletRow.userId,
    sourceWallet: transfer.sourceWallet,
    txSignature: transfer.signature,
    amountUsdc: amount.toFixed(6),
    slot: BigInt(transfer.slot),
    confirmations: 0,
    status: rejection ? 'rejected' : 'pending',
    rejectionReason: rejection,
    rawPayload: rawPayload ?? null,
  };
  await db.insert(deposits).values(newDeposit);

  if (rejection) {
    return { kind: 'deposit_rejected', depositId: id, reason: rejection };
  }
  return { kind: 'deposit', depositId: id, status: 'pending' };
}
