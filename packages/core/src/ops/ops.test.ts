import { describe, expect, it, vi } from 'vitest';
import { evaluateOps } from './evaluate';
import { dispatchOpsAlerts } from './notifier';
import type { OpsAlertSpec, OpsSnapshot } from './types';

function healthy(): OpsSnapshot {
  return {
    crons: [{ job: 'settle', lastStatus: 'ok', lastRunAgeMinutes: 1, stale: false, failing: false }],
    reconciliation: { lastStatus: 'ok', ageMinutes: 5, driftUsdc: '0' },
    tvlUsdc: 100,
    frozenComponents: [],
  };
}

describe('evaluateOps (pure)', () => {
  it('healthy snapshot → no alerts', () => {
    expect(evaluateOps(healthy())).toEqual([]);
  });

  it('stale cron → cron_stale (warning)', () => {
    const s = healthy();
    s.crons = [{ job: 'risk', lastStatus: 'ok', lastRunAgeMinutes: 999, stale: true, failing: false }];
    const a = evaluateOps(s);
    expect(a.find((x) => x.type === 'cron_stale')?.severity).toBe('warning');
    expect(a.find((x) => x.type === 'cron_stale')?.dedupKey).toBe('risk');
  });

  it('failing cron → cron_failed (critical)', () => {
    const s = healthy();
    s.crons = [{ job: 'settle', lastStatus: 'failed', lastRunAgeMinutes: 2, stale: false, failing: true }];
    expect(evaluateOps(s).find((x) => x.type === 'cron_failed')?.severity).toBe('critical');
  });

  it('reconciliation drift → reconciliation_drift (critical)', () => {
    const s = healthy();
    s.reconciliation = { lastStatus: 'drift', ageMinutes: 1, driftUsdc: '12.5' };
    expect(evaluateOps(s).find((x) => x.type === 'reconciliation_drift')?.severity).toBe('critical');
  });

  it('reconciliation never run → reconciliation_stale', () => {
    const s = healthy();
    s.reconciliation = { lastStatus: 'never', ageMinutes: null, driftUsdc: null };
    expect(evaluateOps(s).some((x) => x.type === 'reconciliation_stale')).toBe(true);
  });

  it('TVL near cap → tvl_near_cap', () => {
    const s = healthy();
    s.tvlUsdc = 950; // default cap 1000, warn 0.9 → ≥900
    expect(evaluateOps(s).some((x) => x.type === 'tvl_near_cap')).toBe(true);
  });

  it('freeze active → freeze_active', () => {
    const s = healthy();
    s.frozenComponents = ['settlements'];
    const a = evaluateOps(s);
    expect(a.find((x) => x.type === 'freeze_active')?.evidence).toMatchObject({
      components: ['settlements'],
    });
  });
});

describe('dispatchOpsAlerts (generic webhook, no vendor lock-in)', () => {
  const specs: OpsAlertSpec[] = [
    { type: 'cron_stale', severity: 'warning', dedupKey: 'risk', title: 'stale', evidence: {} },
    { type: 'reconciliation_drift', severity: 'critical', dedupKey: 'recon', title: 'drift', evidence: {} },
    { type: 'freeze_active', severity: 'info', dedupKey: 'freeze', title: 'freeze', evidence: {} },
  ];

  it('no webhook configured → no-op (system runs without any external dependency)', async () => {
    const res = await dispatchOpsAlerts(specs, { webhookUrl: null });
    expect(res.dispatched).toBe(0);
  });

  it('posts a vendor-neutral envelope for alerts ≥ minSeverity', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    const res = await dispatchOpsAlerts(specs, {
      webhookUrl: 'https://hook.example/relay',
      minSeverity: 'warning',
      fetchImpl,
    });

    expect(res.dispatched).toBe(2); // warning + critical, info filtered out
    expect(calls[0]!.body).toMatchObject({ source: 'rivlayx-ops', type: 'cron_stale' });
    expect(calls.every((c) => c.url === 'https://hook.example/relay')).toBe(true);
  });
});
