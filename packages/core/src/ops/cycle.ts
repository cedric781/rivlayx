import { OPS_DEFAULTS, type OpsConfig } from './config';
import { evaluateOps, gatherOpsSnapshot } from './evaluate';
import { resolveClearedOpsAlerts, upsertOpsAlert } from './monitor';
import { dispatchOpsAlerts, type NotifierConfig } from './notifier';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OpsDb = any;

export interface OpsCycleResult {
  evaluated: number;
  created: number;
  resolved: number;
  dispatched: number;
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
  const specs = evaluateOps(snapshot, config);

  const activeKeys = specs.map((s) => `${s.type}|${s.dedupKey}`);
  const newlyCreated = [];
  for (const spec of specs) {
    const created = await upsertOpsAlert(db, spec, config);
    if (created) newlyCreated.push(spec);
  }

  const resolved = await resolveClearedOpsAlerts(db, activeKeys);

  let dispatched = 0;
  if (opts.notifier) {
    const res = await dispatchOpsAlerts(newlyCreated, opts.notifier);
    dispatched = res.dispatched;
  }

  return { evaluated: specs.length, created: newlyCreated.length, resolved, dispatched };
}
