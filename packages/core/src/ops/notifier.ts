import type { OpsAlertSpec } from './types';

/**
 * Generic webhook notifier — **no vendor SDK, no lock-in.** The destination is
 * whatever URL the operator configures (Slack/PagerDuty/Datadog/OpsGenie/a relay
 * — the engine neither knows nor cares). If no URL is configured this is a
 * no-op, so the system runs fine without any external dependency.
 *
 * Posts a vendor-neutral JSON envelope; adapting it to a specific provider is a
 * config/relay concern, not a code dependency here.
 */
export interface NotifierConfig {
  /** Destination webhook URL, or null/empty to disable (no-op). */
  webhookUrl: string | null;
  /** Only dispatch alerts at or above this severity. */
  minSeverity?: 'info' | 'warning' | 'critical';
  /** Injected for testing; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

const SEVERITY_RANK: Record<string, number> = { info: 0, warning: 1, critical: 2 };

export interface DispatchResult {
  dispatched: number;
  skipped: number;
}

/** Dispatch newly-created alerts to the configured webhook. Best-effort. */
export async function dispatchOpsAlerts(
  specs: OpsAlertSpec[],
  config: NotifierConfig,
): Promise<DispatchResult> {
  const min = SEVERITY_RANK[config.minSeverity ?? 'warning'] ?? 1;
  const eligible = specs.filter((s) => (SEVERITY_RANK[s.severity] ?? 0) >= min);

  if (!config.webhookUrl) return { dispatched: 0, skipped: eligible.length };

  const doFetch = config.fetchImpl ?? fetch;
  let dispatched = 0;
  for (const s of eligible) {
    try {
      await doFetch(config.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source: 'rivlayx-ops',
          type: s.type,
          severity: s.severity,
          title: s.title,
          dedupKey: s.dedupKey,
          evidence: s.evidence,
        }),
      });
      dispatched++;
    } catch {
      // Best-effort: a failed page must never break the ops cycle.
    }
  }
  return { dispatched, skipped: eligible.length - dispatched };
}
