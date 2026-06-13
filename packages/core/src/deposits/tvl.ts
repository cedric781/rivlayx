import Decimal from 'decimal.js';
import { sql } from 'drizzle-orm';
import { ledgerEntries } from '@rivlayx/db';
import type { LedgerDb } from '../ledger/types';

/**
 * Current total value locked across all user-owed accounts.
 * TVL = Σ credits − Σ debits on:
 *   - user_available
 *   - bet_escrow
 *   - bet_creation_fee_hold
 *   - dispute_deposit_hold
 *
 * Excludes platform_fee + treasury (platform-owned, not user-owed).
 */
export async function computeCurrentTvl(db: LedgerDb): Promise<string> {
  const [row] = await db
    .select({
      credit: sql<string>`COALESCE(SUM(CASE WHEN ${ledgerEntries.direction} = 'credit' THEN ${ledgerEntries.amountUsdc} ELSE 0 END), 0)`,
      debit: sql<string>`COALESCE(SUM(CASE WHEN ${ledgerEntries.direction} = 'debit' THEN ${ledgerEntries.amountUsdc} ELSE 0 END), 0)`,
    })
    .from(ledgerEntries)
    .where(
      sql`${ledgerEntries.accountType} IN ('user_available', 'bet_escrow', 'bet_creation_fee_hold', 'dispute_deposit_hold')`,
    );

  const credit = new Decimal(row?.credit ?? '0');
  const debit = new Decimal(row?.debit ?? '0');
  return credit.sub(debit).toFixed(6);
}

export interface TvlCheckResult {
  exceeds: boolean;
  currentTvl: string;
  afterTvl: string;
  cap: string;
}

/**
 * Predict whether crediting `amountUsdc` would push TVL above `maxTvlUsdc`.
 * Both bounds inclusive — equality is OK, strict gt is the only rejection.
 */
export async function wouldExceedTvlCap(
  db: LedgerDb,
  amountUsdc: string,
  maxTvlUsdc: string,
): Promise<TvlCheckResult> {
  const currentTvl = await computeCurrentTvl(db);
  const after = new Decimal(currentTvl).add(new Decimal(amountUsdc));
  const cap = new Decimal(maxTvlUsdc);
  return {
    exceeds: after.gt(cap),
    currentTvl,
    afterTvl: after.toFixed(6),
    cap: cap.toFixed(6),
  };
}
