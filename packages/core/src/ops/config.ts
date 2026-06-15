import type { OpsAlertType, OpsSeverity } from '@rivlayx/db';

/**
 * Ops/observability tuning in one place. `cron_runs`, `ops_alerts` and the
 * health endpoints are the **internal source of truth**; alerting output is a
 * **generic webhook** whose destination is config-driven — there is no vendor
 * SDK or lock-in (PagerDuty/Datadog/Sentry/OpsGenie are reachable only by
 * pointing the webhook at them). See `docs/production-hardening-design.md`.
 */
export interface OpsConfig {
  /** Expected crons: interval + grace (stale once age > interval·grace). */
  crons: Record<string, { intervalMinutes: number; graceMultiplier: number }>;
  /**
   * `cron_runs` retention (G1). Rows older than `retentionDays` are pruned by the
   * ops cycle, in bounded batches of `pruneBatch` — but the latest row per job is
   * always kept, so freshness never regresses to `never`.
   */
  cronRuns: { retentionDays: number; pruneBatch: number };
  /** Reconciliation freshness: stale once the last run is older than this. */
  reconciliation: { maxAgeMinutes: number };
  /** TVL monitor: warn as TVL approaches the cap. */
  tvl: { capUsdc: number; warnRatio: number };
  /** Runbook URL per alert type (relative path; ops console links these). */
  runbooks: Record<OpsAlertType, string>;
  /** Default severities per alert type (evaluator may escalate). */
  severities: Record<OpsAlertType, OpsSeverity>;
}

export const OPS_DEFAULTS: OpsConfig = {
  crons: {
    'auto-resolve': { intervalMinutes: 5, graceMultiplier: 3 },
    settle: { intervalMinutes: 5, graceMultiplier: 3 },
    recon: { intervalMinutes: 60, graceMultiplier: 2 },
    reputation: { intervalMinutes: 5, graceMultiplier: 3 },
    risk: { intervalMinutes: 15, graceMultiplier: 3 },
    ops: { intervalMinutes: 15, graceMultiplier: 3 },
  },
  cronRuns: { retentionDays: 30, pruneBatch: 1000 },
  reconciliation: { maxAgeMinutes: 180 },
  tvl: { capUsdc: 1000, warnRatio: 0.9 },
  runbooks: {
    cron_stale: '/docs/runbooks#cron-stuck',
    cron_failed: '/docs/runbooks#cron-stuck',
    reconciliation_drift: '/docs/runbooks#reconciliation-mismatch',
    reconciliation_stale: '/docs/runbooks#reconciliation-mismatch',
    tvl_near_cap: '/docs/runbooks#tvl-breach',
    freeze_active: '/docs/runbooks#freeze-unfreeze',
    health_degraded: '/docs/runbooks#incident-response',
  },
  severities: {
    cron_stale: 'warning',
    cron_failed: 'critical',
    reconciliation_drift: 'critical',
    reconciliation_stale: 'warning',
    tvl_near_cap: 'warning',
    freeze_active: 'warning',
    health_degraded: 'warning',
  },
};
