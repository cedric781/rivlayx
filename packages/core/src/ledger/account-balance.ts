import Decimal from 'decimal.js';
import { and, eq, sql } from 'drizzle-orm';
import { ledgerEntries, type AccountType } from '@rivlayx/db';
import type { LedgerDb } from './types';

/**
 * Net `Σdebit − Σcredit` across all entries for an account type (optionally
 * narrowed to a single `accountRef`). For asset accounts (deposit_holding,
 * withdrawal_pending) this is the account's balance; for other account classes
 * the caller interprets the sign against the account's normal balance.
 */
export async function accountDebitMinusCredit(
  db: LedgerDb,
  accountType: AccountType,
  accountRef?: string,
): Promise<Decimal> {
  const where = accountRef
    ? and(eq(ledgerEntries.accountType, accountType), eq(ledgerEntries.accountRef, accountRef))
    : eq(ledgerEntries.accountType, accountType);
  const [row] = await db
    .select({
      debit: sql<string>`COALESCE(SUM(CASE WHEN ${ledgerEntries.direction} = 'debit' THEN ${ledgerEntries.amountUsdc} ELSE 0 END), 0)`,
      credit: sql<string>`COALESCE(SUM(CASE WHEN ${ledgerEntries.direction} = 'credit' THEN ${ledgerEntries.amountUsdc} ELSE 0 END), 0)`,
    })
    .from(ledgerEntries)
    .where(where);
  return new Decimal(row?.debit ?? '0').sub(new Decimal(row?.credit ?? '0'));
}

/**
 * Ledger view of USDC physically held in the platform vault: the
 * `deposit_holding` asset balance (`Σdebit − Σcredit`). Deposits debit it;
 * on-chain payouts credit it (Sprint 11 C1). This is the figure that must
 * equal the on-chain vault balance, net of in-flight uncredited deposits —
 * NOT the cumulative credit volume, which inflates on every internal move.
 *
 * Summed across all `accountRef`s because historic entries used both 'vault'
 * and 'platform' as the deposit_holding ref.
 */
export async function depositHoldingBalance(db: LedgerDb): Promise<Decimal> {
  return accountDebitMinusCredit(db, 'deposit_holding');
}
