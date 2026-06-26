import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { onchainTransfers, reconciliationRuns, withdrawalRequests } from '@rivlayx/db';
import { OPS_DEFAULTS, type OpsConfig } from './config';
import { computeCurrentTvl } from '../deposits/tvl';
import { getCronHealth } from './cron-runs';
import type {
  HealthStatus,
  OpsAlertSpec,
  OpsSnapshot,
  TransferConditionHealth,
  TransferHealth,
} from './types';

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

  // ── C2: money-transfer alerting. A failed transfer (money did not move) pages
  // critical; a stuck transfer (submitted/processing too long) pages warning.
  // Each condition collapses to ONE alert via a stable dedupKey, so N failures
  // never spam — the count rides in the evidence, and it auto-resolves when the
  // condition clears. (type, dedupKey) is the dedup identity, so transfer_failed
  // and transfer_stuck can share the 'withdrawals' key without colliding. ──
  const t = snapshot.transfers;
  if (t.failedWithdrawals.count > 0) {
    specs.push({
      type: 'transfer_failed',
      severity: config.severities.transfer_failed,
      dedupKey: 'withdrawals',
      title: `${t.failedWithdrawals.count} withdrawal(s) failed in the last ${config.transfers.recentFailureWindowMinutes}m`,
      evidence: {
        count: t.failedWithdrawals.count,
        sampleIds: t.failedWithdrawals.sampleIds,
        windowMinutes: config.transfers.recentFailureWindowMinutes,
      },
    });
  }
  if (t.stuckOnchain.count > 0) {
    specs.push({
      type: 'transfer_stuck',
      severity: config.severities.transfer_stuck,
      dedupKey: 'onchain_transfers',
      title: `${t.stuckOnchain.count} on-chain transfer(s) stuck in submitted > ${config.transfers.stuckMinutes}m`,
      evidence: {
        count: t.stuckOnchain.count,
        oldestMinutes: t.stuckOnchain.oldestMinutes,
        sampleIds: t.stuckOnchain.sampleIds,
        thresholdMinutes: config.transfers.stuckMinutes,
      },
    });
  }
  if (t.stuckWithdrawals.count > 0) {
    specs.push({
      type: 'transfer_stuck',
      severity: config.severities.transfer_stuck,
      dedupKey: 'withdrawals',
      title: `${t.stuckWithdrawals.count} withdrawal(s) stuck in processing > ${config.transfers.stuckMinutes}m`,
      evidence: {
        count: t.stuckWithdrawals.count,
        oldestMinutes: t.stuckWithdrawals.oldestMinutes,
        sampleIds: t.stuckWithdrawals.sampleIds,
        thresholdMinutes: config.transfers.stuckMinutes,
      },
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

  const transfers = await gatherTransferHealth(db, config);

  return { crons, reconciliation, tvlUsdc, frozenComponents, transfers };
}

/**
 * Read-only gather of failed/stuck money transfers. Three independent conditions
 * (failed withdrawals, stuck on-chain transfers, stuck processing withdrawals);
 * each returns a count + oldest age + a bounded id sample for the alert evidence.
 * Pure SELECTs — never writes, never touches the money path.
 */
export async function gatherTransferHealth(
  db: OpsDb,
  config: OpsConfig = OPS_DEFAULTS,
): Promise<TransferHealth> {
  const now = Date.now();
  const failedSince = new Date(now - config.transfers.recentFailureWindowMinutes * 60_000);
  const stuckBefore = new Date(now - config.transfers.stuckMinutes * 60_000);
  const lim = config.transfers.sampleLimit;

  const summarize = (
    rows: Array<{ id: unknown; at: unknown }>,
  ): TransferConditionHealth => ({
    count: rows.length,
    oldestMinutes: rows.length
      ? Math.round((now - new Date(String(rows[0]!.at)).getTime()) / 60_000)
      : null,
    sampleIds: rows.slice(0, lim).map((r) => String(r.id)),
  });

  // Failed withdrawals within the lookback window (newest first → sample is recent).
  const failedRows = await db
    .select({ id: withdrawalRequests.id, at: withdrawalRequests.failedAt })
    .from(withdrawalRequests)
    .where(and(eq(withdrawalRequests.status, 'failed'), gte(withdrawalRequests.failedAt, failedSince)))
    .orderBy(desc(withdrawalRequests.failedAt));

  // On-chain transfers stuck in `submitted` past the threshold (oldest first).
  const stuckOcRows = await db
    .select({ id: onchainTransfers.id, at: onchainTransfers.submittedAt })
    .from(onchainTransfers)
    .where(and(eq(onchainTransfers.status, 'submitted'), lt(onchainTransfers.submittedAt, stuckBefore)))
    .orderBy(asc(onchainTransfers.submittedAt));

  // Withdrawals stuck in `processing` past the threshold (oldest first).
  const stuckWdRows = await db
    .select({ id: withdrawalRequests.id, at: withdrawalRequests.processingAt })
    .from(withdrawalRequests)
    .where(
      and(eq(withdrawalRequests.status, 'processing'), lt(withdrawalRequests.processingAt, stuckBefore)),
    )
    .orderBy(asc(withdrawalRequests.processingAt));

  return {
    failedWithdrawals: summarize(failedRows),
    stuckOnchain: summarize(stuckOcRows),
    stuckWithdrawals: summarize(stuckWdRows),
  };
}
