import { sql } from 'drizzle-orm';
import type { LedgerDb } from '../ledger/types';

export interface AdvisoryLockResult<T> {
  /** True when the lock was acquired and `fn` ran. */
  ran: boolean;
  /** `fn`'s return value, or null when skipped (lock already held). */
  result: T | null;
}

/** Stable advisory-lock keys, one per cron cycle. Arbitrary but fixed. */
export const CRON_LOCK_KEYS = {
  settle: 920_001,
  recon: 920_002,
  autoResolve: 920_003,
} as const;

/**
 * Run `fn` while holding a Postgres session-level advisory lock keyed by
 * `key`. If the lock is already held by another session (an overlapping cron
 * invocation), returns `{ran:false}` without running `fn` — so cron ticks
 * never double-run a cycle. The lock is always released, even if `fn` throws.
 *
 * Note: the contended (`ran:false`) path requires a second connection holding
 * the lock and so is not exercisable on the single-connection test driver; the
 * acquire-run-release path and lock release on throw are covered.
 */
export async function withAdvisoryLock<T>(
  db: LedgerDb,
  key: number,
  fn: () => Promise<T>,
): Promise<AdvisoryLockResult<T>> {
  const rows = await db.execute(sql`SELECT pg_try_advisory_lock(${key}) AS locked`);
  if (!readLocked(rows)) return { ran: false, result: null };
  try {
    const result = await fn();
    return { ran: true, result };
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(${key})`);
  }
}

function readLocked(rows: unknown): boolean {
  const arr =
    (rows as { rows?: Array<Record<string, unknown>> }).rows ??
    (Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : []);
  const v = arr[0]?.['locked'];
  return v === true || v === 't' || v === 1;
}
