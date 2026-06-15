import { sql } from 'drizzle-orm';
import { cronRuns } from '@rivlayx/db';
import { OPS_DEFAULTS, type OpsConfig } from './config';
import type { CronHealth } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OpsDb = any;

function rowsOf(res: unknown): Array<Record<string, unknown>> {
  return (
    (res as { rows?: Array<Record<string, unknown>> }).rows ??
    (Array.isArray(res) ? (res as Array<Record<string, unknown>>) : [])
  );
}

/**
 * Instrument a cron invocation: record one `cron_runs` row with status +
 * duration. Pure observability — wraps the existing work, never alters it. The
 * wrapped fn returns an advisory-lock-style `{ ran }` result: `ran:false` ⇒
 * `skipped` (lock held), otherwise `ok`; a thrown error ⇒ `failed` (rethrown).
 * Recording failures are swallowed so instrumentation can never break a cron.
 */
export async function recordCronRun<T extends { ran: boolean }>(
  db: OpsDb,
  job: string,
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = new Date();
  try {
    const result = await fn();
    await safeInsert(db, job, result.ran ? 'ok' : 'skipped', startedAt, {});
    return result;
  } catch (err) {
    await safeInsert(db, job, 'failed', startedAt, {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

async function safeInsert(
  db: OpsDb,
  job: string,
  status: 'ok' | 'skipped' | 'failed',
  startedAt: Date,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    const finishedAt = new Date();
    await db.insert(cronRuns).values({
      job,
      status,
      startedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
      details,
    });
  } catch {
    // Never let instrumentation break the cron.
  }
}

/**
 * Prune old `cron_runs` rows (G1). Deletes rows older than the retention window
 * in one bounded batch (`pruneBatch`) — a backlog drains over successive cycles.
 * **Never deletes the latest row per job** (guard: only delete a row that has a
 * newer sibling for the same job), so a rarely-run job keeps its freshness row
 * and never falsely flips to `never`. Returns the number of rows pruned.
 */
export async function pruneCronRuns(db: OpsDb, config: OpsConfig = OPS_DEFAULTS): Promise<number> {
  const cutoff = new Date(Date.now() - config.cronRuns.retentionDays * 86_400_000).toISOString();
  const batch = config.cronRuns.pruneBatch;
  const res = await db.execute(sql`
    DELETE FROM "app"."cron_runs"
    WHERE id IN (
      SELECT cr.id
      FROM "app"."cron_runs" cr
      WHERE cr.finished_at < ${cutoff}::timestamptz
        AND EXISTS (
          SELECT 1 FROM "app"."cron_runs" newer
          WHERE newer.job = cr.job AND newer.finished_at > cr.finished_at
        )
      LIMIT ${batch}
    )
    RETURNING id`);
  return rowsOf(res).length;
}

/** Freshness of every expected cron, derived from the latest `cron_runs` row. */
export async function getCronHealth(
  db: OpsDb,
  config: OpsConfig = OPS_DEFAULTS,
): Promise<CronHealth[]> {
  const rows = rowsOf(
    await db.execute(sql`
      SELECT DISTINCT ON (job) job, status, finished_at
      FROM "app"."cron_runs"
      ORDER BY job, finished_at DESC`),
  );
  const latest = new Map<string, { status: string; finishedAt: string }>();
  for (const r of rows) {
    latest.set(String(r['job']), {
      status: String(r['status']),
      finishedAt: String(r['finished_at']),
    });
  }

  const now = Date.now();
  return Object.entries(config.crons).map(([job, cfg]) => {
    const row = latest.get(job);
    if (!row) {
      return { job, lastStatus: 'never', lastRunAgeMinutes: null, stale: true, failing: false };
    }
    const ageMinutes = (now - new Date(row.finishedAt).getTime()) / 60_000;
    const stale = ageMinutes > cfg.intervalMinutes * cfg.graceMultiplier;
    return {
      job,
      lastStatus: row.status as CronHealth['lastStatus'],
      lastRunAgeMinutes: Math.round(ageMinutes),
      stale,
      failing: row.status === 'failed',
    };
  });
}
