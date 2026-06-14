import type { OpsAlertType, OpsSeverity } from '@rivlayx/db';

export type { OpsAlertType, OpsSeverity };

/** Freshness view of one cron job, derived from `cron_runs`. */
export interface CronHealth {
  job: string;
  lastStatus: 'ok' | 'skipped' | 'failed' | 'never';
  /** Age of the last run in minutes (null if never run). */
  lastRunAgeMinutes: number | null;
  /** True when the last run is older than interval·grace (or never ran). */
  stale: boolean;
  /** True when the most recent run failed. */
  failing: boolean;
}

/** Point-in-time snapshot of the signals the evaluator scores. Pure input. */
export interface OpsSnapshot {
  crons: CronHealth[];
  reconciliation: {
    lastStatus: 'ok' | 'drift' | 'halt' | 'never';
    ageMinutes: number | null;
    driftUsdc: string | null;
  };
  tvlUsdc: number;
  frozenComponents: string[];
}

/** A would-be alert produced by the pure evaluator. */
export interface OpsAlertSpec {
  type: OpsAlertType;
  severity: OpsSeverity;
  dedupKey: string;
  title: string;
  evidence: Record<string, unknown>;
}

export type HealthStatus = 'ok' | 'degraded' | 'down';

export interface HealthCheck {
  name: string;
  status: HealthStatus;
  detail?: string;
}

export interface HealthSnapshot {
  status: HealthStatus;
  checks: HealthCheck[];
}
