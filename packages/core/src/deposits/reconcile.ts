import Decimal from 'decimal.js';
import { sql } from 'drizzle-orm';
import { deposits } from '@rivlayx/db';
import type { IHeliusRpc } from '@rivlayx/helius';
import { runReconciliation, type ReconciliationResult } from '../ledger/reconciliation';
import type { LedgerDb } from '../ledger/types';

export interface VaultReconciliationInput {
  vaultAta: string;
  rpc: IHeliusRpc;
}

/**
 * Reconcile vault on-chain USDC against the ledger, correcting for in-flight
 * deposits that are physically in the vault but not yet credited.
 *
 *   effective_on_chain = on_chain_vault − in_flight_deposits
 *
 *   in_flight_deposits = Σ amount where status IN ('pending', 'confirmed')
 *
 * This `effective_on_chain` is what the ledger should match. Passed through
 * to `runReconciliation`, which compares it against the `deposit_holding`
 * asset balance (the ledger's view of vault holdings) and persists a
 * `reconciliation_runs` row. The in-flight subtraction lines up with that
 * target: uncredited deposits are in the vault but not yet in deposit_holding.
 */
export async function reconcileVault(
  db: LedgerDb,
  input: VaultReconciliationInput,
): Promise<ReconciliationResult> {
  const balance = await input.rpc.getTokenAccountBalance(input.vaultAta);

  const [inFlight] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${deposits.amountUsdc}), 0)`,
    })
    .from(deposits)
    .where(sql`${deposits.status} IN ('pending', 'confirmed')`);

  const onChain = new Decimal(balance.uiAmountString);
  const pending = new Decimal(inFlight?.total ?? '0');
  const effective = onChain.sub(pending);

  return runReconciliation(db, { onChainTotalUsdc: effective.toFixed(6) });
}
