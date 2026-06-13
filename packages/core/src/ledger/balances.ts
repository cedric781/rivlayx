import Decimal from 'decimal.js';
import { and, eq, sql } from 'drizzle-orm';
import { balances, ledgerEntries, type Balance } from '@rivlayx/db';
import type { LedgerDb } from './types';

export async function getBalance(db: LedgerDb, userId: string): Promise<Balance | null> {
  const [row] = await db.select().from(balances).where(eq(balances.userId, userId)).limit(1);
  return row ?? null;
}

export interface RecomputedBalance {
  availableUsdc: string;
  lockedUsdc: string;
}

/**
 * Recompute a user's balance directly from the ledger. Used by tests and by
 * reconciliation to verify that the denormalised `balances` row is consistent.
 *
 *   available_usdc = Σ credits − Σ debits  on user_available[userId]
 *   locked_usdc    = Σ credits − Σ debits  on locked accounts
 *                                          where affects_user_id = userId
 */
export async function recomputeBalance(db: LedgerDb, userId: string): Promise<RecomputedBalance> {
  const [availRow] = await db
    .select({
      credit: sql<string>`COALESCE(SUM(CASE WHEN ${ledgerEntries.direction} = 'credit' THEN ${ledgerEntries.amountUsdc} ELSE 0 END), 0)`,
      debit: sql<string>`COALESCE(SUM(CASE WHEN ${ledgerEntries.direction} = 'debit' THEN ${ledgerEntries.amountUsdc} ELSE 0 END), 0)`,
    })
    .from(ledgerEntries)
    .where(
      and(eq(ledgerEntries.accountType, 'user_available'), eq(ledgerEntries.accountRef, userId)),
    );

  const [lockRow] = await db
    .select({
      credit: sql<string>`COALESCE(SUM(CASE WHEN ${ledgerEntries.direction} = 'credit' THEN ${ledgerEntries.amountUsdc} ELSE 0 END), 0)`,
      debit: sql<string>`COALESCE(SUM(CASE WHEN ${ledgerEntries.direction} = 'debit' THEN ${ledgerEntries.amountUsdc} ELSE 0 END), 0)`,
    })
    .from(ledgerEntries)
    .where(
      and(
        eq(ledgerEntries.affectsUserId, userId),
        sql`${ledgerEntries.accountType} IN ('bet_escrow', 'bet_creation_fee_hold', 'dispute_deposit_hold')`,
      ),
    );

  const availableUsdc = new Decimal(availRow?.credit ?? '0')
    .sub(new Decimal(availRow?.debit ?? '0'))
    .toFixed(6);
  const lockedUsdc = new Decimal(lockRow?.credit ?? '0')
    .sub(new Decimal(lockRow?.debit ?? '0'))
    .toFixed(6);

  return { availableUsdc, lockedUsdc };
}
