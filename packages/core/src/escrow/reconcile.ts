import Decimal from 'decimal.js';
import { sql } from 'drizzle-orm';
import { onchainTransfers } from '@rivlayx/db';
import type { IHeliusRpc } from '@rivlayx/helius';
import { accountDebitMinusCredit } from '../ledger/account-balance';
import { DRIFT_THRESHOLD } from '../ledger/reconciliation';
import type { LedgerDb } from '../ledger/types';

/**
 * Escrow-wallet reconciliation (Phase 3D, foundation only — READ-ONLY).
 *
 * Cross-checks three independent views of the central escrow wallet's USDC:
 *
 *   1. actual    — the on-chain escrow ATA balance (RPC).
 *   2. expected  — `Σ finalized stakes − Σ finalized settlement_payouts` from
 *                  `onchain_transfers` (the transfer-log view of what should be
 *                  physically held). Only `finalized` rows feed this midpoint:
 *                  they are the unambiguously-moved funds.
 *   3. ledger    — the `bet_escrow` ledger balance (`Σcredit − Σdebit`).
 *
 * On-chain band (C4 fix). A `submitted` transfer's on-chain tx may already have
 * CONFIRMED — funds physically in/out of escrow — even though our row is not yet
 * `finalized`. Comparing such a balance against a strict `finalized`-only
 * `expected` would false-flag drift, so the on-chain check tolerates a BAND
 * `[expectedLow, expectedHigh]`:
 *
 *   - a submitted stake may already have landed   → raises `expectedHigh`.
 *   - a submitted payout may already have left     → lowers `expectedLow`.
 *
 * `pending` transfers are not yet broadcast, so they stay OUTSIDE the band — their
 * total is reported (`pendingAmount`) so a stuck backlog is visible but never moves
 * `expected`. The ledger check stays STRICT against `expected` (submitted transfers
 * never touch the ledger). `failed` rows and `withdrawal`s (user→external, they do
 * not touch escrow) are ignored entirely.
 *
 * It does NOT write anything: no ledger entries, no freeze, no
 * `reconciliation_runs` row, no RPC mutation. It computes and returns a verdict.
 * Persisting the run and escalating to a freeze belong to the (future) cron
 * wiring — out of scope here. Not wired into any cron or production flow.
 */

export type EscrowReconciliationStatus = 'ok' | 'drift' | 'halt';

export interface EscrowReconciliationInput {
  /** The escrow wallet's USDC associated token account (base58). */
  escrowAta: string;
  rpc: IHeliusRpc;
}

export interface EscrowReconciliationResult {
  status: EscrowReconciliationStatus;
  /** On-chain escrow ATA balance (USDC). */
  actualBalance: string;
  /** Strict midpoint: Σ finalized stakes − Σ finalized payouts (USDC). */
  expectedBalance: string;
  /** Lower band edge: `expected − Σ submitted payouts` (submitted payout may have left). */
  expectedLowBalance: string;
  /** Upper band edge: `expected + Σ submitted stakes` (submitted stake may have landed). */
  expectedHighBalance: string;
  /** `bet_escrow` ledger balance, Σcredit − Σdebit (USDC). */
  ledgerBalance: string;
  /** In-flight `pending` escrow transfers (excluded from the band entirely). */
  pendingAmount: string;
  /** In-flight `submitted` escrow transfers (stake + payout) that widen the band. */
  submittedAmount: string;
  /** Largest of the on-chain-band and ledger-vs-expected gaps (USDC). */
  driftAmount: string;
  details: Record<string, unknown>;
}

export async function reconcileEscrow(
  db: LedgerDb,
  input: EscrowReconciliationInput,
): Promise<EscrowReconciliationResult> {
  // ── 1. Actual on-chain escrow balance ──
  const balance = await input.rpc.getTokenAccountBalance(input.escrowAta);
  const actual = new Decimal(balance.uiAmountString);

  // ── 2. Aggregate escrow-relevant transfers (stake + settlement_payout).
  // `finalized` feeds the strict midpoint; `submitted` is split by direction so each
  // side can widen the band; `pending` is reported only; failed/withdrawals excluded. ──
  const [agg] = await db
    .select({
      finalizedStakes: sql<string>`COALESCE(SUM(CASE WHEN ${onchainTransfers.type} = 'stake' AND ${onchainTransfers.status} = 'finalized' THEN ${onchainTransfers.amountUsdc} ELSE 0 END), 0)`,
      finalizedPayouts: sql<string>`COALESCE(SUM(CASE WHEN ${onchainTransfers.type} = 'settlement_payout' AND ${onchainTransfers.status} = 'finalized' THEN ${onchainTransfers.amountUsdc} ELSE 0 END), 0)`,
      pending: sql<string>`COALESCE(SUM(CASE WHEN ${onchainTransfers.type} IN ('stake', 'settlement_payout') AND ${onchainTransfers.status} = 'pending' THEN ${onchainTransfers.amountUsdc} ELSE 0 END), 0)`,
      submittedStakes: sql<string>`COALESCE(SUM(CASE WHEN ${onchainTransfers.type} = 'stake' AND ${onchainTransfers.status} = 'submitted' THEN ${onchainTransfers.amountUsdc} ELSE 0 END), 0)`,
      submittedPayouts: sql<string>`COALESCE(SUM(CASE WHEN ${onchainTransfers.type} = 'settlement_payout' AND ${onchainTransfers.status} = 'submitted' THEN ${onchainTransfers.amountUsdc} ELSE 0 END), 0)`,
    })
    .from(onchainTransfers);

  const finalizedStakes = new Decimal(agg?.finalizedStakes ?? '0');
  const finalizedPayouts = new Decimal(agg?.finalizedPayouts ?? '0');
  const pendingAmount = new Decimal(agg?.pending ?? '0');
  const submittedStakes = new Decimal(agg?.submittedStakes ?? '0');
  const submittedPayouts = new Decimal(agg?.submittedPayouts ?? '0');
  const submittedAmount = submittedStakes.add(submittedPayouts);
  const expected = finalizedStakes.sub(finalizedPayouts);

  // ── 3. On-chain band. A submitted stake may already have physically landed (balance
  // higher → raise the high edge); a submitted payout may already have physically left
  // (balance lower → lower the low edge). pending stays out — not yet broadcast. ──
  const expectedHigh = expected.add(submittedStakes);
  const expectedLow = expected.sub(submittedPayouts);

  // ── 4. Ledger view: bet_escrow balance = Σcredit − Σdebit (stake-lock credits
  // bet_escrow), so negate `accountDebitMinusCredit` (which is Σdebit − Σcredit). ──
  const ledgerBalance = (await accountDebitMinusCredit(db, 'bet_escrow')).negated();

  // ── 5. Drift. On-chain: 0 while actual sits inside [expectedLow, expectedHigh],
  // otherwise the distance to the nearest band edge. Ledger: stays STRICT against the
  // finalized-only midpoint (submitted transfers never touch the ledger). ──
  const onChainDrift = Decimal.max(expectedLow.sub(actual), actual.sub(expectedHigh), 0);
  const ledgerDrift = ledgerBalance.sub(expected).abs();
  const drift = Decimal.max(onChainDrift, ledgerDrift);

  // ── 6. Classify. A structurally-impossible balance (more finalized payouts
  // than stakes, or a negative escrow/ledger total) is corruption → halt. ──
  let status: EscrowReconciliationStatus;
  if (expected.isNegative() || ledgerBalance.isNegative() || actual.isNegative()) {
    status = 'halt';
  } else if (onChainDrift.gt(DRIFT_THRESHOLD) || ledgerDrift.gt(DRIFT_THRESHOLD)) {
    status = 'drift';
  } else {
    status = 'ok';
  }

  const details: Record<string, unknown> = {
    finalized_stakes: finalizedStakes.toFixed(6),
    finalized_payouts: finalizedPayouts.toFixed(6),
    submitted_stakes: submittedStakes.toFixed(6),
    submitted_payouts: submittedPayouts.toFixed(6),
    expected_low: expectedLow.toFixed(6),
    expected_high: expectedHigh.toFixed(6),
    on_chain_drift: onChainDrift.toFixed(6),
    ledger_drift: ledgerDrift.toFixed(6),
    threshold: DRIFT_THRESHOLD.toFixed(6),
  };
  if (status === 'halt') {
    details['note'] = 'escrow reconciliation inconsistent — negative escrow/ledger total';
  }

  return {
    status,
    actualBalance: actual.toFixed(6),
    expectedBalance: expected.toFixed(6),
    expectedLowBalance: expectedLow.toFixed(6),
    expectedHighBalance: expectedHigh.toFixed(6),
    ledgerBalance: ledgerBalance.toFixed(6),
    pendingAmount: pendingAmount.toFixed(6),
    submittedAmount: submittedAmount.toFixed(6),
    driftAmount: drift.toFixed(6),
    details,
  };
}
