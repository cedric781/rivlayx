import Decimal from 'decimal.js';
import { sql } from 'drizzle-orm';
import { ledgerEntries, reconciliationRuns, type ReconciliationStatus } from '@rivlayx/db';
import { depositHoldingBalance } from './account-balance';
import type { LedgerDb } from './types';

export interface ReconciliationResult {
  status: ReconciliationStatus;
  ledgerTotalUsdc: string;
  onChainTotalUsdc: string | null;
  driftUsdc: string;
  details: Record<string, unknown>;
}

/** Drift above this (in USDC) freezes withdrawals + settlements per blueprint. */
export const DRIFT_THRESHOLD = new Decimal('0.01');

/**
 * Reconciliation:
 *   1. Confirm the ledger is internally consistent
 *      (Σ debits == Σ credits across all entries).
 *   2. If `onChainTotalUsdc` is supplied, compare it against the
 *      `deposit_holding` asset balance (Σdebit − Σcredit) — the ledger's view
 *      of USDC physically in the vault. This is the correct target: cumulative
 *      credit volume inflates on every internal move (escrow lock, settlement)
 *      and would false-flag drift the moment money moves between accounts.
 *
 * `ledgerTotalUsdc` reports the `deposit_holding` balance (the vault view).
 * Always writes a row to `reconciliation_runs` for audit.
 *
 * `status`:
 *   - `'ok'`    consistent (and on-chain matches if supplied)
 *   - `'drift'` on-chain vs deposit_holding balance > threshold
 *   - `'halt'`  ledger internally inconsistent — critical, halt immediately
 */
export async function runReconciliation(
  db: LedgerDb,
  options?: { onChainTotalUsdc?: string | null },
): Promise<ReconciliationResult> {
  const [totals] = await db
    .select({
      debit: sql<string>`COALESCE(SUM(CASE WHEN ${ledgerEntries.direction} = 'debit' THEN ${ledgerEntries.amountUsdc} ELSE 0 END), 0)`,
      credit: sql<string>`COALESCE(SUM(CASE WHEN ${ledgerEntries.direction} = 'credit' THEN ${ledgerEntries.amountUsdc} ELSE 0 END), 0)`,
    })
    .from(ledgerEntries);

  const debit = new Decimal(totals?.debit ?? '0');
  const credit = new Decimal(totals?.credit ?? '0');
  const internalDrift = debit.sub(credit).abs();
  const vaultLedger = await depositHoldingBalance(db);

  let status: ReconciliationStatus = 'ok';
  let drift = internalDrift;
  const details: Record<string, unknown> = {
    debit_sum: debit.toFixed(6),
    credit_sum: credit.toFixed(6),
    internal_drift: internalDrift.toFixed(6),
    deposit_holding: vaultLedger.toFixed(6),
  };

  if (internalDrift.gt(DRIFT_THRESHOLD)) {
    status = 'halt';
    details['note'] = 'ledger debits and credits disagree — possible corruption';
  } else if (options?.onChainTotalUsdc != null) {
    const onChain = new Decimal(options.onChainTotalUsdc);
    drift = vaultLedger.sub(onChain).abs();
    details['on_chain'] = onChain.toFixed(6);
    details['deposit_holding_vs_on_chain'] = drift.toFixed(6);
    if (drift.gt(DRIFT_THRESHOLD)) status = 'drift';
  }

  await db.insert(reconciliationRuns).values({
    ledgerTotalUsdc: vaultLedger.toFixed(6),
    onChainTotalUsdc: options?.onChainTotalUsdc ?? null,
    driftUsdc: drift.toFixed(6),
    status,
    details,
  });

  return {
    status,
    ledgerTotalUsdc: vaultLedger.toFixed(6),
    onChainTotalUsdc: options?.onChainTotalUsdc ?? null,
    driftUsdc: drift.toFixed(6),
    details,
  };
}
