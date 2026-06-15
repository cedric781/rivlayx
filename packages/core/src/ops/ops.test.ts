import { describe, expect, it, vi } from 'vitest';
import { evaluateOps } from './evaluate';
import { dispatchOpsAlerts } from './notifier';
import type { DispatchableAlert, OpsSnapshot } from './types';

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

describe('evaluateOps — health_degraded catch-all (G3)', () => {
  it('healthy roll-up → no catch-all', () => {
    expect(evaluateOps(healthy(), undefined, 'ok')).toEqual([]);
    expect(evaluateOps(healthy(), undefined, undefined)).toEqual([]);
  });

  it('degraded roll-up with no specific alert → health_degraded (warning)', () => {
    const a = evaluateOps(healthy(), undefined, 'degraded');
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ type: 'health_degraded', severity: 'warning', dedupKey: 'health' });
    expect(a[0]!.evidence).toMatchObject({ healthStatus: 'degraded' });
  });

  it('down roll-up with no specific alert → health_degraded escalated to critical', () => {
    expect(evaluateOps(healthy(), undefined, 'down')[0]).toMatchObject({
      type: 'health_degraded',
      severity: 'critical',
    });
  });

  it('never double-pages: a specific alert suppresses the catch-all', () => {
    const s = healthy();
    s.crons = [{ job: 'settle', lastStatus: 'failed', lastRunAgeMinutes: 2, stale: false, failing: true }];
    const a = evaluateOps(s, undefined, 'down');
    expect(a.some((x) => x.type === 'cron_failed')).toBe(true);
    expect(a.some((x) => x.type === 'health_degraded')).toBe(false);
  });
});

describe('dispatchOpsAlerts (generic webhook, no vendor lock-in)', () => {
  const at = new Date('2026-06-14T22:30:00.000Z');
  const alerts: DispatchableAlert[] = [
    { id: 'a1', type: 'cron_stale', severity: 'warning', dedupKey: 'risk', title: 'stale', evidence: {}, runbookUrl: '/docs/runbooks#cron-stuck', createdAt: at },
    { id: 'a2', type: 'reconciliation_drift', severity: 'critical', dedupKey: 'recon', title: 'drift', evidence: {}, runbookUrl: '/docs/runbooks#reconciliation-mismatch', createdAt: at },
    { id: 'a3', type: 'freeze_active', severity: 'info', dedupKey: 'freeze', title: 'freeze', evidence: {}, runbookUrl: null, createdAt: at },
  ];

  it('no webhook configured → no-op (system runs without any external dependency)', async () => {
    const res = await dispatchOpsAlerts(alerts, { webhookUrl: null });
    expect(res.dispatched).toBe(0);
  });

  it('posts an enriched, vendor-neutral envelope for alerts ≥ minSeverity', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    const res = await dispatchOpsAlerts(alerts, {
      webhookUrl: 'https://hook.example/relay',
      minSeverity: 'warning',
      publicBaseUrl: 'https://ops.rivlayx.com/',
      fetchImpl,
    });

    expect(res.dispatched).toBe(2); // warning + critical, info filtered out
    expect(calls[0]!.body).toMatchObject({
      source: 'rivlayx-ops',
      id: 'a1',
      type: 'cron_stale',
      runbookUrl: 'https://ops.rivlayx.com/docs/runbooks#cron-stuck', // absolute
      timestamp: '2026-06-14T22:30:00.000Z',
    });
    expect(calls.every((c) => c.url === 'https://hook.example/relay')).toBe(true);
  });

  it('falls back to the relative runbook path when no publicBaseUrl is set', async () => {
    const calls: Array<{ body: Record<string, unknown> }> = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push({ body: JSON.parse(String(init?.body)) });
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    await dispatchOpsAlerts([alerts[0]!], { webhookUrl: 'https://hook.example/relay', fetchImpl });
    expect(calls[0]!.body['runbookUrl']).toBe('/docs/runbooks#cron-stuck');
  });

  it('best-effort: a failing webhook never throws out of the cycle', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('relay down');
    }) as unknown as typeof fetch;
    const res = await dispatchOpsAlerts([alerts[1]!], { webhookUrl: 'https://hook.example/relay', fetchImpl });
    expect(res).toEqual({ dispatched: 0, skipped: 1 });
  });
});
