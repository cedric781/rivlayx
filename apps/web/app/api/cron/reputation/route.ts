import { NextResponse } from 'next/server';
import { cron, reputation } from '@rivlayx/core';
import { getDb } from '@/lib/db';
import { requireCron } from '@/lib/auth/require-cron';

export const dynamic = 'force-dynamic';

/**
 * Reputation worker cron (Sprint 15). Default: drain the recompute outbox
 * (event-driven refreshes from settlement / dispute ruling / moderation).
 * `?full=1`: recompute every user — the nightly safety sweep + one-off backfill.
 *
 * Reputation is fully decoupled from the money-path: this is where the actual
 * scoring happens, never inside settlement.
 */
export async function GET(request: Request) {
  const auth = requireCron(request);
  if (!auth.ok) return auth.response;

  const full = new URL(request.url).searchParams.get('full') === '1';
  const db = getDb();
  const locked = await cron.withAdvisoryLock(db, cron.CRON_LOCK_KEYS.reputation, async () =>
    reputation.runReputationCycle(db, { full }),
  );

  if (!locked.ran) return NextResponse.json({ skipped: true, reason: 'lock_held' });
  return NextResponse.json({ ok: true, full, ...locked.result });
}
