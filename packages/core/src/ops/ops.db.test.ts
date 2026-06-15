import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ne, sql } from 'drizzle-orm';
import { cronRuns, opsAlerts, reconciliationRuns } from '@rivlayx/db';
import { createTestDb, type TestDb } from '@rivlayx/test-utils';
import { OPS_DEFAULTS } from './config';
import { recordCronRun, getCronHealth, pruneCronRuns } from './cron-runs';
import { runOpsCycle } from './cycle';
import { getHealthSnapshot } from './health';

let harness: TestDb;

beforeAll(async () => {
  harness = await createTestDb();
});
afterAll(async () => {
  await harness.close();
});
beforeEach(async () => {
  await harness.pg.exec(
    'TRUNCATE financial.ledger_entries; TRUNCATE financial.balances; ' +
      'TRUNCATE financial.freeze_state CASCADE; ' +
      "INSERT INTO financial.freeze_state (component) VALUES ('new_bets'), ('settlements'), ('withdrawals'), ('all'); " +
      'TRUNCATE app.cron_runs; TRUNCATE app.ops_alerts; TRUNCATE financial.reconciliation_runs;',
  );
});

// Focused config: a single expected cron + default recon/tvl.
const CFG = { ...OPS_DEFAULTS, crons: { settle: { intervalMinutes: 1, graceMultiplier: 1 } } };

async function countOpen(): Promise<number> {
  const [r] = await harness.db
    .select({ n: sql<number>`count(*)` })
    .from(opsAlerts)
    .where(ne(opsAlerts.status, 'resolved'));
  return Number(r!.n);
}

describe('recordCronRun', () => {
  it('records ok / skipped / failed and rethrows on failure', async () => {
    await recordCronRun(harness.db, 'settle', async () => ({ ran: true }));
    await recordCronRun(harness.db, 'settle', async () => ({ ran: false }));
    await expect(
      recordCronRun(harness.db, 'settle', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const rows = await harness.db.select({ status: cronRuns.status }).from(cronRuns);
    const statuses = rows.map((r: { status: string }) => r.status).sort();
    expect(statuses).toEqual(['failed', 'ok', 'skipped']);
  });
});

describe('getCronHealth', () => {
  it('marks a never-run job stale and a fresh job healthy', async () => {
    await recordCronRun(harness.db, 'settle', async () => ({ ran: true }));
    const health = await getCronHealth(harness.db, {
      ...OPS_DEFAULTS,
      crons: { settle: { intervalMinutes: 5, graceMultiplier: 3 }, risk: { intervalMinutes: 5, graceMultiplier: 3 } },
    });
    const settle = health.find((c) => c.job === 'settle')!;
    const risk = health.find((c) => c.job === 'risk')!;
    expect(settle.stale).toBe(false);
    expect(risk.lastStatus).toBe('never');
    expect(risk.stale).toBe(true);
  });
});

describe('pruneCronRuns', () => {
  const DAY = 86_400_000;

  it('prunes rows older than retention but always keeps the latest row per job', async () => {
    const old40 = new Date(Date.now() - 40 * DAY);
    const old35 = new Date(Date.now() - 35 * DAY);
    const recent = new Date(Date.now() - 1 * DAY);
    // settle: two old + one recent → the two old are prunable, recent is latest.
    await harness.db.insert(cronRuns).values([
      { job: 'settle', status: 'ok', startedAt: old40, finishedAt: old40, durationMs: 0 },
      { job: 'settle', status: 'ok', startedAt: old35, finishedAt: old35, durationMs: 0 },
      { job: 'settle', status: 'ok', startedAt: recent, finishedAt: recent, durationMs: 0 },
    ]);
    // recon: ONLY one old row → it is the latest, must be kept (no false 'never').
    await harness.db
      .insert(cronRuns)
      .values({ job: 'recon', status: 'ok', startedAt: old40, finishedAt: old40, durationMs: 0 });

    const pruned = await pruneCronRuns(harness.db, OPS_DEFAULTS);
    expect(pruned).toBe(2);

    const rows = await harness.db.select({ job: cronRuns.job }).from(cronRuns);
    const jobs = rows.map((r: { job: string }) => r.job).sort();
    expect(jobs).toEqual(['recon', 'settle']); // one row left per job

    // The rarely-run recon job must still report a real last run, not `never`.
    const health = await getCronHealth(harness.db, {
      ...OPS_DEFAULTS,
      crons: { recon: { intervalMinutes: 60, graceMultiplier: 2 } },
    });
    expect(health.find((c) => c.job === 'recon')!.lastStatus).toBe('ok');
  });

  it('respects the bounded prune batch', async () => {
    const old = new Date(Date.now() - 40 * DAY);
    const recent = new Date();
    await harness.db.insert(cronRuns).values([
      ...Array.from({ length: 5 }, () => ({
        job: 'risk',
        status: 'ok' as const,
        startedAt: old,
        finishedAt: old,
        durationMs: 0,
      })),
      { job: 'risk', status: 'ok' as const, startedAt: recent, finishedAt: recent, durationMs: 0 },
    ]);

    const cfg = { ...OPS_DEFAULTS, cronRuns: { retentionDays: 30, pruneBatch: 2 } };
    expect(await pruneCronRuns(harness.db, cfg)).toBe(2); // bounded to the batch
    expect(await pruneCronRuns(harness.db, cfg)).toBe(2); // drains over cycles
    expect(await pruneCronRuns(harness.db, cfg)).toBe(1); // last old row
    expect(await pruneCronRuns(harness.db, cfg)).toBe(0); // only the latest remains
  });
});

describe('runOpsCycle', () => {
  it('creates alerts, dedups on re-run, and auto-resolves when healthy', async () => {
    // Stale cron (finished 10 min ago vs interval·grace = 1 min) + never-run recon.
    const past = new Date(Date.now() - 10 * 60_000);
    await harness.db
      .insert(cronRuns)
      .values({ job: 'settle', status: 'ok', startedAt: past, finishedAt: past, durationMs: 0 });

    const first = await runOpsCycle(harness.db, { config: CFG });
    expect(first.created).toBeGreaterThanOrEqual(2); // cron_stale + reconciliation_stale
    const openAfterFirst = await countOpen();

    // Re-run with the same unhealthy state → dedup, no new open alerts.
    const second = await runOpsCycle(harness.db, { config: CFG });
    expect(second.created).toBe(0);
    expect(await countOpen()).toBe(openAfterFirst);

    // Heal: fresh settle run + a recent ok reconciliation → alerts auto-resolve.
    await harness.db
      .insert(cronRuns)
      .values({ job: 'settle', status: 'ok', startedAt: new Date(), finishedAt: new Date(), durationMs: 5 });
    await harness.db.insert(reconciliationRuns).values({
      status: 'ok',
      ledgerTotalUsdc: '0',
      onChainTotalUsdc: '0',
      driftUsdc: '0',
    });

    const third = await runOpsCycle(harness.db, { config: CFG });
    expect(third.resolved).toBeGreaterThanOrEqual(2);
    expect(await countOpen()).toBe(0);
  });

  it('dispatches an enriched webhook payload (id + absolute runbook + timestamp) for new alerts', async () => {
    const past = new Date(Date.now() - 10 * 60_000);
    await harness.db
      .insert(cronRuns)
      .values({ job: 'settle', status: 'ok', startedAt: past, finishedAt: past, durationMs: 0 });

    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    const res = await runOpsCycle(harness.db, {
      config: CFG,
      notifier: {
        webhookUrl: 'https://hook.example/relay',
        publicBaseUrl: 'https://ops.rivlayx.com',
        fetchImpl,
      },
    });

    expect(res.dispatched).toBeGreaterThanOrEqual(1);
    const cronStale = bodies.find((b) => b['type'] === 'cron_stale')!;
    expect(cronStale).toMatchObject({
      source: 'rivlayx-ops',
      type: 'cron_stale',
      runbookUrl: 'https://ops.rivlayx.com/docs/runbooks#cron-stuck',
    });
    expect(typeof cronStale['id']).toBe('string'); // persisted uuid handle
    expect(typeof cronStale['timestamp']).toBe('string'); // ISO created_at
  });
});

describe('getHealthSnapshot', () => {
  it('reports degraded on a stale cron and ok when healthy', async () => {
    const degraded = await getHealthSnapshot(harness.db, CFG);
    expect(degraded.status).not.toBe('ok'); // settle never ran + recon never
    expect(degraded.checks.find((c) => c.name === 'database')?.status).toBe('ok');

    await harness.db
      .insert(cronRuns)
      .values({ job: 'settle', status: 'ok', startedAt: new Date(), finishedAt: new Date(), durationMs: 1 });
    await harness.db.insert(reconciliationRuns).values({
      status: 'ok',
      ledgerTotalUsdc: '0',
      onChainTotalUsdc: '0',
      driftUsdc: '0',
    });
    const ok = await getHealthSnapshot(harness.db, CFG);
    expect(ok.status).toBe('ok');
  });
});

describe('isolation — ops never touches the money path', () => {
  it('a full ops cycle mutates no money tables', async () => {
    const count = async (t: string) => {
      const r = await harness.pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t}`);
      return r.rows[0]!.n;
    };
    const before = {
      ledger: await count('financial.ledger_entries'),
      balances: await count('financial.balances'),
      deposits: await count('financial.deposits'),
    };
    await runOpsCycle(harness.db, { config: CFG });
    expect({
      ledger: await count('financial.ledger_entries'),
      balances: await count('financial.balances'),
      deposits: await count('financial.deposits'),
    }).toEqual(before);
  });
});
