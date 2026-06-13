import { eq, sql } from 'drizzle-orm';
import { balances, ledgerEntries, type NewLedgerEntry } from '@rivlayx/db';
import { computeBalanceDeltas } from './accounting';
import { validateLedgerTxn } from './validate';
import type { LedgerDb, PostLedgerResult, PostLedgerTxnInput } from './types';

/**
 * Atomically post a double-entry ledger transaction.
 *
 *   - Validates inputs + invariants (see `validateLedgerTxn`).
 *   - Idempotent on `requestId`: a replay returns the existing `txnId`
 *     without re-inserting.
 *   - Updates per-user `balances.available_usdc` / `locked_usdc` inside the
 *     same transaction. CHECK constraints (>= 0) act as a safety net.
 *   - Concurrent identical writes are serialised by the
 *     UNIQUE(request_id, entry_index) index.
 *
 * `postLedgerTxn` opens its own transaction; use `postLedgerTxnIn` when the
 * caller is already inside a transaction (e.g. the bet engine wraps create +
 * accept + expire flows in a single Drizzle transaction so the bet rows and
 * the ledger move together atomically).
 */
export async function postLedgerTxn(
  db: LedgerDb,
  input: PostLedgerTxnInput,
): Promise<PostLedgerResult> {
  return db.transaction((tx: LedgerDb) => postLedgerTxnIn(tx, input));
}

/**
 * Inner variant that runs against an existing transaction context. Identical
 * semantics to `postLedgerTxn` but doesn't open its own transaction.
 */
export async function postLedgerTxnIn(
  tx: LedgerDb,
  input: PostLedgerTxnInput,
): Promise<PostLedgerResult> {
  const validated = validateLedgerTxn(input);
  const deltas = computeBalanceDeltas(validated.entries);

  const existing = await tx
    .select({ txnId: ledgerEntries.txnId })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.requestId, validated.requestId))
    .limit(1);

  if (existing[0]) {
    return {
      status: 'idempotent_replay' as const,
      txnId: existing[0].txnId,
      entryCount: 0,
    };
  }

  const rows: NewLedgerEntry[] = validated.entries.map((e, entryIndex) => ({
    txnId: validated.txnId,
    entryIndex,
    accountType: e.accountType,
    accountRef: e.accountRef,
    direction: e.direction,
    amountUsdc: e.amountUsdc,
    betId: e.betId ?? null,
    relatedTxSignature: e.relatedTxSignature ?? null,
    affectsUserId: e.affectsUserId ?? null,
    reason: e.reason,
    requestId: validated.requestId,
    createdBy: validated.createdBy,
  }));
  await tx.insert(ledgerEntries).values(rows);

  for (const userId of deltas.keys()) {
    await tx
      .insert(balances)
      .values({ userId, availableUsdc: '0', lockedUsdc: '0' })
      .onConflictDoNothing();
  }
  for (const [userId, delta] of deltas) {
    await tx
      .update(balances)
      .set({
        availableUsdc: sql`${balances.availableUsdc} + ${delta.availableDelta.toFixed(6)}`,
        lockedUsdc: sql`${balances.lockedUsdc} + ${delta.lockedDelta.toFixed(6)}`,
        version: sql`${balances.version} + 1`,
        refreshedAt: sql`now()`,
      })
      .where(eq(balances.userId, userId));
  }

  return {
    status: 'posted' as const,
    txnId: validated.txnId,
    entryCount: rows.length,
  };
}
