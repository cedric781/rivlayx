import { NextResponse } from 'next/server';
import { deposits, cron, ops } from '@rivlayx/core';
import { getDb } from '@/lib/db';
import { requireCron } from '@/lib/auth/require-cron';
import { buildHeliusRpc } from '@/lib/helius/rpc';

export const dynamic = 'force-dynamic';

/**
 * Deposit poller cron (C6B). Drives `processPendingDeposits`: walks `pending`
 * deposits and credits them ONLY at real `finalized` finality (verified via
 * `RealHeliusRpc`). Advisory-locked so overlapping ticks never double-run; the
 * underlying pipeline is idempotent so a webhook/poller race is safe.
 *
 * Skips gracefully when no live RPC is configured (`SOLANA_RPC_URL` unset) —
 * deposits stay pending until it is, never credited on a fabricated status.
 */
export async function GET(request: Request) {
  const auth = requireCron(request);
  if (!auth.ok) return auth.response;

  const rpc = buildHeliusRpc();
  if (!rpc) {
    return NextResponse.json({ skipped: true, reason: 'rpc_not_configured' });
  }

  const db = getDb();
  const locked = await ops.recordCronRun(db, 'deposits', () =>
    cron.withAdvisoryLock(db, cron.CRON_LOCK_KEYS.deposits, async () =>
      deposits.processPendingDeposits(db, rpc),
    ),
  );

  if (!locked.ran) return NextResponse.json({ skipped: true, reason: 'lock_held' });
  return NextResponse.json({ ok: true, ...locked.result });
}
