import { NextResponse } from 'next/server';
import { cron, ops, risk } from '@rivlayx/core';
import { getDb } from '@/lib/db';
import { requireCron } from '@/lib/auth/require-cron';

export const dynamic = 'force-dynamic';

/**
 * Risk engine cron (Sprint 17) — SHADOW MODE, read-only. Default: scan recent
 * activity into the work queue and drain it (score + raise advisory alerts).
 * `?full=1`: rebuild the counterparty graph and recompute every user + cluster
 * alerts (nightly sweep + one-off backfill).
 *
 * This NEVER blocks, freezes, limits, stops payouts or influences settlement —
 * it only computes scores and raises alerts for analyst review.
 */
export async function GET(request: Request) {
  const auth = requireCron(request);
  if (!auth.ok) return auth.response;

  const full = new URL(request.url).searchParams.get('full') === '1';
  const db = getDb();
  const locked = await ops.recordCronRun(db, 'risk', () =>
    cron.withAdvisoryLock(db, cron.CRON_LOCK_KEYS.risk, async () =>
      risk.runRiskCycle(db, { full }),
    ),
  );

  if (!locked.ran) return NextResponse.json({ skipped: true, reason: 'lock_held' });
  return NextResponse.json({ ok: true, full, ...locked.result });
}
