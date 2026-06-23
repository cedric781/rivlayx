import { NextResponse } from 'next/server';
import { withdrawals, cron, ops } from '@rivlayx/core';
import { getDb } from '@/lib/db';
import { requireCron } from '@/lib/auth/require-cron';
import { buildTransferProvider } from '@/lib/payouts/provider';
import { getWithdrawalLimits } from '@/lib/withdrawals/limits';

export const dynamic = 'force-dynamic';

/**
 * Withdrawal runner cron (Sprint 31). Drives the existing
 * `processWithdrawalQueue`: approved → processing → paid. Advisory-locked so
 * only one runner drains at a time; freeze-aware inside the engine.
 */
export async function GET(request: Request) {
  const auth = requireCron(request);
  if (!auth.ok) return auth.response;

  const db = getDb();
  const provider = buildTransferProvider();
  const limits = getWithdrawalLimits();
  const locked = await ops.recordCronRun(db, 'withdrawals', () =>
    cron.withAdvisoryLock(db, cron.CRON_LOCK_KEYS.withdrawals, async () =>
      withdrawals.processWithdrawalQueue(db, provider, { limits }),
    ),
  );

  if (!locked.ran) return NextResponse.json({ skipped: true, reason: 'lock_held' });
  return NextResponse.json({ ok: true, ...locked.result });
}
