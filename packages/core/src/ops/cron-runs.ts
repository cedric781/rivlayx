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
