import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ne, sql } from 'drizzle-orm';
import { cronRuns, opsAlerts, reconciliationRuns } from '@rivlayx/db';
import { createTestDb, type TestDb } from '@rivlayx/test-utils';
import { OPS_DEFAULTS } from './config';
import { recordCronRun, getCronHealth } from './cron-runs';
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
