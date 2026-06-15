import { sql } from 'drizzle-orm';
import { OPS_DEFAULTS, type OpsConfig } from './config';
import { gatherOpsSnapshot } from './evaluate';
import type { HealthCheck, HealthSnapshot, HealthStatus, OpsSnapshot } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OpsDb = any;

function worst(a: HealthStatus, b: HealthStatus): HealthStatus {
  const rank: Record<HealthStatus, number> = { ok: 0, degraded: 1, down: 2 };
  return rank[a] >= rank[b] ? a : b;
}

/**
 * Deep health snapshot for `/api/ops/health` — DB reachability + the ops
 * signals (reconciliation freshness, cron freshness, freeze state). Read-only;
 * computes status, never changes anything.
 */
export async function getHealthSnapshot(
  db: OpsDb,
  config: OpsConfig = OPS_DEFAULTS,
  snapshot?: OpsSnapshot,
): Promise<HealthSnapshot> {
  const checks: HealthCheck[] = [];

  // DB reachability first — if this fails, we're down.
  try {
    await db.execute(sql`SELECT 1`);
    checks.push({ name: 'database', status: 'ok' });
  } catch (err) {
    checks.push({
      name: 'database',
      status: 'down',
      detail: err instanceof Error ? err.message : String(err),
    });
    return { status: 'down', checks };
  }

  // Reuse a pre-gathered snapshot when the caller already has one (the ops cycle),
  // avoiding a second gather; otherwise gather fresh (the health endpoint).
  const snap = snapshot ?? (await gatherOpsSnapshot(db, config));

  const staleOrFailing = snap.crons.filter((c) => c.stale || c.failing);
  checks.push({
    name: 'crons',
    status: staleOrFailing.length > 0 ? 'degraded' : 'ok',
    detail: staleOrFailing.length > 0 ? `${staleOrFailing.map((c) => c.job).join(', ')}` : undefined,
  });

  const r = snap.reconciliation;
  const reconStatus: HealthStatus =
    r.lastStatus === 'drift' || r.lastStatus === 'halt'
      ? 'down'
      : r.lastStatus === 'never' || (r.ageMinutes !== null && r.ageMinutes > config.reconciliation.maxAgeMinutes)
        ? 'degraded'
        : 'ok';
  checks.push({ name: 'reconciliation', status: reconStatus, detail: `${r.lastStatus}` });

  checks.push({
    name: 'freeze',
    status: snap.frozenComponents.length > 0 ? 'degraded' : 'ok',
    detail: snap.frozenComponents.length > 0 ? snap.frozenComponents.join(', ') : undefined,
  });

  const status = checks.reduce<HealthStatus>((acc, c) => worst(acc, c.status), 'ok');
  return { status, checks };
}
