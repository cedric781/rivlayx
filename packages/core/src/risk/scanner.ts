import { sql } from 'drizzle-orm';
import type { RiskRefreshReason } from '@rivlayx/db';
import { enqueueRiskRecompute } from './queue';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RiskDb = any;

function rowsOf(res: unknown): Array<Record<string, unknown>> {
  return (
    (res as { rows?: Array<Record<string, unknown>> }).rows ??
    (Array.isArray(res) ? (res as Array<Record<string, unknown>>) : [])
  );
}

export interface ScanResult {
  enqueued: number;
}

/**
 * Self-driven scanner — the risk engine discovers its own work by reading
 * existing activity timestamps (`bets.updated_at`, `disputes.opened_at`,
 * `deposits.detected_at`) since a lookback window. This deliberately avoids
 * adding enqueue hooks inside money-path transactions, so settlement / dispute /
 * deposit code stays untouched. Read-only except for the risk work queue.
 */
export async function scanRecentActivity(
  db: RiskDb,
  opts: { sinceMinutes?: number } = {},
): Promise<ScanResult> {
  const minutes = opts.sinceMinutes ?? 60;
  const rows = rowsOf(
    await db.execute(sql`
      SELECT user_id, max(reason) AS reason FROM (
        SELECT creator_user_id AS user_id, 'bet_activity' AS reason FROM "app"."bets"
          WHERE updated_at >= now() - (${minutes} || ' minutes')::interval
        UNION ALL
        SELECT acceptor_user_id AS user_id, 'bet_activity' AS reason FROM "app"."bets"
          WHERE acceptor_user_id IS NOT NULL AND updated_at >= now() - (${minutes} || ' minutes')::interval
        UNION ALL
        SELECT opener_user_id AS user_id, 'dispute_activity' AS reason FROM "app"."disputes"
          WHERE opened_at >= now() - (${minutes} || ' minutes')::interval
        UNION ALL
        SELECT user_id, 'deposit_activity' AS reason FROM "financial"."deposits"
          WHERE detected_at >= now() - (${minutes} || ' minutes')::interval
      ) s WHERE user_id IS NOT NULL GROUP BY user_id`),
  );

  let enqueued = 0;
  for (const r of rows) {
    await enqueueRiskRecompute(db, String(r['user_id']), String(r['reason']) as RiskRefreshReason);
    enqueued++;
  }
  return { enqueued };
}
