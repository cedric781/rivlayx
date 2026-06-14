import { NextResponse } from 'next/server';
import { ops } from '@rivlayx/core';
import { getDb } from '@/lib/db';
import { requireCron } from '@/lib/auth/require-cron';

export const dynamic = 'force-dynamic';

/**
 * Deep readiness/health (Sprint 23) — DB reachability + reconciliation
 * freshness + cron freshness + freeze state. Gated by the cron secret (used by
 * uptime monitors / on-call tooling). Read-only; never changes money state.
 * Returns 200 when `ok`, 503 when `degraded`/`down` so external monitors page.
 */
export async function GET(request: Request) {
  const auth = requireCron(request);
  if (!auth.ok) return auth.response;

  const snapshot = await ops.getHealthSnapshot(getDb());
  const httpStatus = snapshot.status === 'ok' ? 200 : 503;
  return NextResponse.json(snapshot, { status: httpStatus });
}
