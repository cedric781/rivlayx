import { NextResponse } from 'next/server';
import { bets, payouts, cron, ops } from '@rivlayx/core';
import { getDb } from '@/lib/db';
import { requireCron } from '@/lib/auth/require-cron';

export const dynamic = 'force-dynamic';

/**
 * Settlement cron (Sprint 12a): settle RESOLVED bets, then enqueue payouts for
 * any SETTLED-but-unpaid bet. Enqueue only creates `payouts` rows — the drain
 * (processPayoutQueue) is intentionally NOT wired in 12a, so no money moves.
 */
export async function GET(request: Request) {
  const auth = requireCron(request);
  if (!auth.ok) return auth.response;

  const db = getDb();
  const locked = await ops.recordCronRun(db, 'settle', () =>
    cron.withAdvisoryLock(db, cron.CRON_LOCK_KEYS.settle, async () => {
      const settle = await bets.runSettlementCycle(db);
      // When settlement is frozen the cycle hard-skips; halt payout enqueue too
      // so nothing advances while the kill-switch is on.
      const enqueue =
        settle.skipped === 'frozen'
          ? ({ skipped: 'frozen' } as const)
          : await payouts.queuePendingForSettledBets(db);
      return { settle, enqueue };
    }),
  );

  if (!locked.ran) return NextResponse.json({ skipped: true, reason: 'lock_held' });
  return NextResponse.json({ ok: true, ...locked.result });
}
