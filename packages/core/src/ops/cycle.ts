import { OPS_DEFAULTS, type OpsConfig } from './config';
import { evaluateOps, gatherOpsSnapshot } from './evaluate';
import { pruneCronRuns } from './cron-runs';
import { getHealthSnapshot } from './health';
import { resolveClearedOpsAlerts, upsertOpsAlert } from './monitor';
import { dispatchOpsAlerts, type NotifierConfig } from './notifier';
import type { DispatchableAlert } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OpsDb = any;

export interface OpsCycleResult {
  evaluated: number;
  created: number;
  resolved: number;
  dispatched: number;
  pruned: number;
}

/**
 * Ops cron entry point — gather → evaluate → persist (dedup/suppress) →
 * auto-resolve cleared → dispatch new alerts to the configured webhook.
 * Internal tables (`ops_alerts`) are the source of truth; the webhook is just a
 * fan-out. Read-only against money state; writes only ops tables.
 */
export async function runOpsCycle(
  db: OpsDb,
  opts: { config?: OpsConfig; notifier?: NotifierConfig } = {},
): Promise<OpsCycleResult> {
  const config = opts.config ?? OPS_DEFAULTS;
  const snapshot = await gatherOpsSnapshot(db, config);
  // Roll-up reuses the snapshot we just gathered (no second gather); feeds the
  // G3 `health_degraded` catch-all.
  const health = await getHealthSnapshot(db, config, snapshot);
  const specs = evaluateOps(snapshot, config, health.status);

  const activeKeys = specs.map((s) => `${s.type}|${s.dedupKey}`);
  const newlyCreated: DispatchableAlert[] = [];
  for (const spec of specs) {
    const created = await upsertOpsAlert(db, spec, config);
    if (created) newlyCreated.push(created);
  }

  const resolved = await resolveClearedOpsAlerts(db, activeKeys);

  let dispatched = 0;
  if (opts.notifier) {
    const res = await dispatchOpsAlerts(newlyCreated, opts.notifier);
    dispatched = res.dispatched;
  }

  const pruned = await pruneCronRuns(db, config);

  return { evaluated: specs.length, created: newlyCreated.length, resolved, dispatched, pruned };
}
