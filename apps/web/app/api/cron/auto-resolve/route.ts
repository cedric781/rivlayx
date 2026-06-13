import { NextResponse } from 'next/server';
import { bets, cron } from '@rivlayx/core';
import { getDb } from '@/lib/db';
import { requireCron } from '@/lib/auth/require-cron';
import { buildProviderRegistry } from '@/lib/cron/provider-registry';

export const dynamic = 'force-dynamic';

/**
 * Auto-resolve cron (Sprint 12a): thin wiring over the existing
 * `runAutoResolveCycle` — proposes results for eligible auto bets and closes
 * elapsed dispute windows (→ RESOLVED). No new auto-resolve logic. Feeds the
 * settle cron downstream.
 */
export async function GET(request: Request) {
  const auth = requireCron(request);
  if (!auth.ok) return auth.response;

  const db = getDb();
  const registry = buildProviderRegistry();
  const locked = await cron.withAdvisoryLock(db, cron.CRON_LOCK_KEYS.autoResolve, async () =>
    bets.runAutoResolveCycle(db, registry),
  );

  if (!locked.ran) return NextResponse.json({ skipped: true, reason: 'lock_held' });
  const cycle = locked.result!;
  return NextResponse.json({
    ok: true,
    proposed: cycle.proposed.length,
    closed: cycle.closed.length,
    details: cycle,
  });
}
