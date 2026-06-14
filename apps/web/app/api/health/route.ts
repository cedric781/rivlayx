import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Liveness probe (Sprint 23) — public, no dependencies. Confirms the process is
 * up and serving. Deep dependency health (DB, reconciliation, crons, freeze) is
 * the authed `/api/ops/health` endpoint. No money state is touched.
 */
export function GET() {
  return NextResponse.json({ ok: true, status: 'alive' });
}
