import { NextResponse } from 'next/server';
import { cron, ops } from '@rivlayx/core';
import { getDb } from '@/lib/db';
import { requireCron } from '@/lib/auth/require-cron';

export const dynamic = 'force-dynamic';

/**
 * Ops monitoring cron (Sprint 23) — gather health signals → evaluate →
 * persist/dedup `ops_alerts` → auto-resolve cleared → dispatch new alerts to a
 * generic webhook (config-driven; no vendor SDK). `ops_alerts`/`cron_runs` are
 * the internal source of truth. Read-only against money state.
 */
export async function GET(request: Request) {
  const auth = requireCron(request);
  if (!auth.ok) return auth.response;

  const db = getDb();
  const webhookUrl = process.env['OPS_ALERT_WEBHOOK_URL'] ?? null;
  const publicBaseUrl = process.env['OPS_PUBLIC_BASE_URL'] ?? null;

  const locked = await ops.recordCronRun(db, 'ops', () =>
    cron.withAdvisoryLock(db, cron.CRON_LOCK_KEYS.ops, async () =>
      ops.runOpsCycle(db, { notifier: { webhookUrl, publicBaseUrl } }),
    ),
  );

  if (!locked.ran) return NextResponse.json({ skipped: true, reason: 'lock_held' });
  return NextResponse.json({ ok: true, ...locked.result });
}
