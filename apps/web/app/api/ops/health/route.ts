import { NextResponse } from 'next/server';
import { ops } from '@rivlayx/core';
import { getDb } from '@/lib/db';
import { requireHealth } from '@/lib/auth/require-health';

export const dynamic = 'force-dynamic';

/**
 * Deep readiness/health (Sprint 23, auth hardened Sprint 24 G4) — DB
 * reachability + reconciliation freshness + cron freshness + freeze state.
 * Gated by `OPS_HEALTH_TOKEN` (monitoring vendors) OR the cron secret (internal),
 * never sharing `CRON_SECRET` with vendors. Read-only; never changes money state.
 * Returns 200 when `ok`, 503 when `degraded`/`down` so external monitors page.
 */
export async function GET(request: Request) {
  const auth = requireHealth(request);
  if (!auth.ok) return auth.response;

  const snapshot = await ops.getHealthSnapshot(getDb());
  const httpStatus = snapshot.status === 'ok' ? 200 : 503;
  return NextResponse.json(snapshot, { status: httpStatus });
}
