import { NextResponse } from 'next/server';
import { ledger, cron } from '@rivlayx/core';
import { getDb } from '@/lib/db';
import { requireCron } from '@/lib/auth/require-cron';

export const dynamic = 'force-dynamic';

/**
 * Reconciliation cron (Sprint 12a). Runs internal-consistency reconciliation
 * (Σdebit == Σcredit). The on-chain leg is gated on a live Solana RPC client,
 * which does not exist yet (excluded with real-transfer work) — so prod runs in
 * internal-only mode for now; the comparison itself is covered by tests via the
 * mock RPC.
 *
 * On `halt` or `drift`, escalates by freezing `settlements` + `withdrawals`
 * (system actor — null user id), per the blueprint.
 */
export async function GET(request: Request) {
  const auth = requireCron(request);
  if (!auth.ok) return auth.response;

  const db = getDb();
  const locked = await cron.withAdvisoryLock(db, cron.CRON_LOCK_KEYS.recon, async () => {
    const result = await ledger.runReconciliation(db);
    if (result.status === 'halt' || result.status === 'drift') {
      const reason = `auto-freeze: reconciliation ${result.status} (drift ${result.driftUsdc})`;
      await ledger.setFreeze(db, 'settlements', true, { actorUserId: null, reason });
      await ledger.setFreeze(db, 'withdrawals', true, { actorUserId: null, reason });
    }
    return result;
  });

  if (!locked.ran) return NextResponse.json({ skipped: true, reason: 'lock_held' });
  const result = locked.result!;
  const httpStatus = result.status === 'ok' ? 200 : 503;
  return NextResponse.json({ ok: result.status === 'ok', recon: result }, { status: httpStatus });
}
