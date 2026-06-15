import { desc, sql } from 'drizzle-orm';
import { reconciliationRuns } from '@rivlayx/db';
import { OPS_DEFAULTS, type OpsConfig } from './config';
import { computeCurrentTvl } from '../deposits/tvl';
import { getCronHealth } from './cron-runs';
import type { HealthStatus, OpsAlertSpec, OpsSnapshot } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OpsDb = any;

/**
 * Pure ops evaluation: a snapshot in → would-be alerts out. No DB, no clock, so
 * the thresholds are unit-testable. Advisory only — these alerts never change
 * money-path behaviour. (Reconciliation's own auto-freeze lives in the recon
 * cron; this layer adds *visibility + paging*, not enforcement.)
 *
 * `healthStatus` (G3) is the `getHealthSnapshot` roll-up. It drives the
 * `health_degraded` **catch-all**: emitted only when the roll-up is non-`ok` but
 * **none** of the six specific alerts fired — the "something is wrong we didn't
 * name" net. By construction it never double-pages a named condition.
 */
export function evaluateOps(
  snapshot: OpsSnapshot,
  config: OpsConfig = OPS_DEFAULTS,
  healthStatus?: HealthStatus,
): OpsAlertSpec[] {
  const specs: OpsAlertSpec[] = [];

  for (const c of snapshot.crons) {
    if (c.failing) {
      specs.push({
        type: 'cron_failed',
        severity: config.severities.cron_failed,
        dedupKey: c.job,
        title: `Cron "${c.job}" last run failed`,
        evidence: { job: c.job, lastStatus: c.lastStatus, ageMinutes: c.lastRunAgeMinutes },
      });
    } else if (c.stale) {
      specs.push({
        type: 'cron_stale',
        severity: config.severities.cron_stale,
        dedupKey: c.job,
        title: `Cron "${c.job}" is stale`,
        evidence: { job: c.job, lastStatus: c.lastStatus, ageMinutes: c.lastRunAgeMinutes },
      });
    }
  }

  const r = snapshot.reconciliation;
  if (r.lastStatus === 'drift' || r.lastStatus === 'halt') {
    specs.push({
      type: 'reconciliation_drift',
      severity: config.severities.reconciliation_drift,
      dedupKey: 'recon',
      title: `Reconciliation ${r.lastStatus} (drift ${r.driftUsdc ?? '?'} USDC)`,
      evidence: { status: r.lastStatus, driftUsdc: r.driftUsdc, ageMinutes: r.ageMinutes },
    });
  }
  if (r.lastStatus === 'never' || (r.ageMinutes !== null && r.ageMinutes > config.reconciliation.maxAgeMinutes)) {
    specs.push({
      type: 'reconciliation_stale',
      severity: config.severities.reconciliation_stale,
      dedupKey: 'recon',
      title: 'Reconciliation has not run recently',
      evidence: { status: r.lastStatus, ageMinutes: r.ageMinutes, maxAgeMinutes: config.reconciliation.maxAgeMinutes },
    });
  }

  if (config.tvl.capUsdc > 0 && snapshot.tvlUsdc >= config.tvl.capUsdc * config.tvl.warnRatio) {
    specs.push({
      type: 'tvl_near_cap',
      severity: config.severities.tvl_near_cap,
      dedupKey: 'tvl',
      title: `TVL ${snapshot.tvlUsdc} approaching cap ${config.tvl.capUsdc}`,
      evidence: { tvlUsdc: snapshot.tvlUsdc, capUsdc: config.tvl.capUsdc },
    });
  }

  if (snapshot.frozenComponents.length > 0) {
    specs.push({
      type: 'freeze_active',
      severity: config.severities.freeze_active,
      dedupKey: 'freeze',
      title: `Freeze active: ${snapshot.frozenComponents.join(', ')}`,
      evidence: { components: snapshot.frozenComponents },
    });
  }

  // G3 catch-all: a degraded/down health roll-up that no specific alert above
  // already named. Fires only when `specs` is empty, so it never double-pages.
  if (specs.length === 0 && healthStatus && healthStatus !== 'ok') {
    specs.push({
      type: 'health_degraded',
      severity: healthStatus === 'down' ? 'critical' : config.severities.health_degraded,
      dedupKey: 'health',
      title: `System health ${healthStatus} with no specific alert`,
      evidence: { healthStatus },
    });
  }

  return specs;
}

function rowsOf(res: unknown): Array<Record<string, unknown>> {
  return (
    (res as { rows?: Array<Record<string, unknown>> }).rows ??
    (Array.isArray(res) ? (res as Array<Record<string, unknown>>) : [])
  );
}

/** Read-only gather of the ops snapshot from live state. */
export async function gatherOpsSnapshot(
  db: OpsDb,
  config: OpsConfig = OPS_DEFAULTS,
): Promise<OpsSnapshot> {
  const crons = await getCronHealth(db, config);

  const [recon] = await db
    .select({
      status: reconciliationRuns.status,
      runAt: reconciliationRuns.runAt,
      drift: reconciliationRuns.driftUsdc,
    })
    .from(reconciliationRuns)
    .orderBy(desc(reconciliationRuns.runAt))
    .limit(1);
  const reconciliation = recon
    ? {
        lastStatus: recon.status as OpsSnapshot['reconciliation']['lastStatus'],
        ageMinutes: Math.round((Date.now() - new Date(recon.runAt).getTime()) / 60_000),
        driftUsdc: recon.drift ?? null,
      }
    : { lastStatus: 'never' as const, ageMinutes: null, driftUsdc: null };

  const tvlUsdc = Number(await computeCurrentTvl(db));

  const frozenRows = rowsOf(
    await db.execute(sql`SELECT component FROM "financial"."freeze_state" WHERE frozen = true`),
  );
  const frozenComponents = frozenRows.map((r) => String(r['component']));

  return { crons, reconciliation, tvlUsdc, frozenComponents };
}
