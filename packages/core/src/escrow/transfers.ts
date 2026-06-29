import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  onchainTransfers,
  type OnchainTransfer,
  type OnchainTransferStatus,
  type OnchainTransferType,
} from '@rivlayx/db';
import type { LedgerDb } from '../ledger/types';

/**
 * On-chain transfer record helpers (Phase 3, foundation only). Manage the
 * `financial.onchain_transfers` lifecycle with enforced transitions:
 *
 *   pending   → submitted | failed
 *   submitted → finalized | failed
 *   finalized / failed = terminal
 *
 * `createTransferRecord` is idempotent on `idempotency_key`. No live money flow
 * writes here yet — these helpers are exercised only by tests in Phase 3.
 */

export type OnchainTransferErrorCode = 'NOT_FOUND' | 'INVALID_TRANSITION';

export class OnchainTransferError extends Error {
  readonly code: OnchainTransferErrorCode;
  constructor(code: OnchainTransferErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'OnchainTransferError';
  }
}

export interface CreateOnchainTransferInput {
  type: OnchainTransferType;
  userId: string;
  betId?: string | null;
  sourceWallet: string;
  destinationWallet: string;
  amountUsdc: string;
  mint: string;
  caip2?: string | null;
  /** Logical-transfer identity, e.g. `stake:{betId}:{userId}`. */
  idempotencyKey: string;
  maxAttempts?: number;
}

export interface CreateOnchainTransferResult {
  transfer: OnchainTransfer;
  /** False when an existing record was returned (idempotent replay). */
  created: boolean;
}

/**
 * Insert a `pending` transfer record, idempotent on `idempotency_key`: a second
 * create with the same key returns the existing row with `created:false`.
 */
export async function createTransferRecord(
  db: LedgerDb,
  input: CreateOnchainTransferInput,
): Promise<CreateOnchainTransferResult> {
  const inserted = await db
    .insert(onchainTransfers)
    .values({
      type: input.type,
      userId: input.userId,
      betId: input.betId ?? null,
      sourceWallet: input.sourceWallet,
      destinationWallet: input.destinationWallet,
      amountUsdc: input.amountUsdc,
      mint: input.mint,
      caip2: input.caip2 ?? null,
      idempotencyKey: input.idempotencyKey,
      status: 'pending',
      ...(input.maxAttempts != null ? { maxAttempts: input.maxAttempts } : {}),
    })
    .onConflictDoNothing({ target: onchainTransfers.idempotencyKey })
    .returning();

  if (inserted[0]) return { transfer: inserted[0], created: true };

  const [existing] = await db
    .select()
    .from(onchainTransfers)
    .where(eq(onchainTransfers.idempotencyKey, input.idempotencyKey))
    .limit(1);
  return { transfer: existing!, created: false };
}

export async function getTransfer(db: LedgerDb, id: string): Promise<OnchainTransfer | null> {
  const [row] = await db.select().from(onchainTransfers).where(eq(onchainTransfers.id, id)).limit(1);
  return row ?? null;
}

/**
 * Apply a guarded status transition: the UPDATE only matches when the row is in
 * an allowed `from` status, so the transition check is atomic. Throws
 * `NOT_FOUND` / `INVALID_TRANSITION` on a miss.
 */
async function transition(
  db: LedgerDb,
  id: string,
  fromStatuses: readonly OnchainTransferStatus[],
  patch: Record<string, unknown>,
  action: string,
): Promise<OnchainTransfer> {
  const updated = await db
    .update(onchainTransfers)
    .set(patch)
    .where(and(eq(onchainTransfers.id, id), inArray(onchainTransfers.status, [...fromStatuses])))
    .returning();
  if (updated[0]) return updated[0];

  const [exists] = await db
    .select({ status: onchainTransfers.status })
    .from(onchainTransfers)
    .where(eq(onchainTransfers.id, id))
    .limit(1);
  if (!exists) throw new OnchainTransferError('NOT_FOUND', `onchain transfer ${id} not found`);
  throw new OnchainTransferError(
    'INVALID_TRANSITION',
    `cannot ${action} a transfer in status '${exists.status}'`,
  );
}

/** pending → submitted: record the signature, stamp submit time, bump attempts. */
export async function markSubmitted(
  db: LedgerDb,
  id: string,
  txSignature: string,
  now: Date = new Date(),
): Promise<OnchainTransfer> {
  return transition(
    db,
    id,
    ['pending'],
    {
      status: 'submitted',
      txSignature,
      submittedAt: now,
      attempts: sql`${onchainTransfers.attempts} + 1`,
    },
    'submit',
  );
}

/** submitted → finalized: stamp finality, link the posted ledger txn. */
export async function markFinalized(
  db: LedgerDb,
  id: string,
  options: { ledgerTxnId?: string; now?: Date } = {},
): Promise<OnchainTransfer> {
  const now = options.now ?? new Date();
  return transition(
    db,
    id,
    ['submitted'],
    { status: 'finalized', finalizedAt: now, ledgerTxnId: options.ledgerTxnId ?? null },
    'finalize',
  );
}

/** pending|submitted → failed: terminal, with the error reason. */
export async function markFailed(
  db: LedgerDb,
  id: string,
  error: string,
  now: Date = new Date(),
): Promise<OnchainTransfer> {
  return transition(
    db,
    id,
    ['pending', 'submitted'],
    { status: 'failed', failedAt: now, lastError: error },
    'fail',
  );
}

/**
 * Lock a transfer row `FOR UPDATE` inside the caller's transaction — the claim
 * primitive the future runner uses to serialise processing. Returns the row, or
 * null when it does not exist. (Mirrors the withdrawal runner's claim pattern.)
 */
export async function claimTransferForUpdate(
  tx: LedgerDb,
  id: string,
): Promise<OnchainTransfer | null> {
  const [row] = await tx
    .select()
    .from(onchainTransfers)
    .where(eq(onchainTransfers.id, id))
    .for('update')
    .limit(1);
  return row ?? null;
}
