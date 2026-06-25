import { escrow, ledger } from '@rivlayx/core';

/**
 * Escrow-wallet reconciliation cron leg (Phase 4 wiring).
 *
 * Runs the already-built, READ-ONLY `reconcileEscrow` and escalates exactly like
 * the deposit-vault leg: on `drift`/`halt` it freezes `settlements` +
 * `withdrawals` (system actor). It moves NO money and starts NO transfers — the
 * only writes are the freeze rows (audited escalation). Structured logs cover
 * status, drift, and the freeze reason; no secrets are logged.
 */

/** DB handle accepted by the core escrow/ledger functions (avoids importing the internal type). */
type ReconDb = Parameters<typeof escrow.reconcileEscrow>[0];
/** `{ escrowAta, rpc }` — the reconcile input, sourced from the type itself. */
type ReconInput = Parameters<typeof escrow.reconcileEscrow>[1];

export async function reconcileEscrowAndEscalate(
  db: ReconDb,
  input: ReconInput,
): Promise<escrow.EscrowReconciliationResult> {
  const result = await escrow.reconcileEscrow(db, input);

  console.info(
    JSON.stringify({
      event: 'escrow_reconcile',
      status: result.status,
      drift: result.driftAmount,
      actual: result.actualBalance,
      expected: result.expectedBalance,
      expectedLow: result.expectedLowBalance,
      expectedHigh: result.expectedHighBalance,
    }),
  );

  if (result.status === 'drift' || result.status === 'halt') {
    const reason = `auto-freeze: escrow reconciliation ${result.status} (drift ${result.driftAmount})`;
    await ledger.setFreeze(db, 'settlements', true, { actorUserId: null, reason });
    await ledger.setFreeze(db, 'withdrawals', true, { actorUserId: null, reason });
    console.warn(JSON.stringify({ event: 'escrow_reconcile_freeze', reason }));
  }

  return result;
}
