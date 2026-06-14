import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import { bets, deposits, disputes, riskAlerts, riskScores, settlements } from '@rivlayx/db';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { createActiveBet, fundUser, linkTestWallet } from '../bets/test-helpers';
import { runRiskCycle } from './recompute';

let harness: TestDb;

beforeAll(async () => {
  harness = await createTestDb();
});
afterAll(async () => {
  await harness.close();
});
beforeEach(async () => {
  await harness.pg.exec(
    'TRUNCATE auth.users CASCADE; ' +
      'TRUNCATE financial.ledger_entries; TRUNCATE financial.balances; ' +
      'TRUNCATE financial.deposits CASCADE; ' +
      'TRUNCATE financial.freeze_state CASCADE; ' +
      "INSERT INTO financial.freeze_state (component) VALUES ('new_bets'), ('settlements'), ('withdrawals'), ('all'); " +
      'TRUNCATE app.bets CASCADE; TRUNCATE app.risk_edges CASCADE; ' +
      'TRUNCATE app.risk_scores CASCADE; TRUNCATE app.risk_alerts CASCADE; ' +
      'TRUNCATE app.risk_recompute_queue CASCADE;',
  );
});

async function makeUser() {
  const u = await createTestUser(harness.db);
  await linkTestWallet(harness.db, u.id);
  await fundUser(harness.db, u.id, '2000');
  return u;
}

/** Insert a winner_payout settlement so wash net-exposure can be measured. */
async function settle(betId: string, winnerId: string, loserId: string, stake = 10) {
  await harness.db.insert(settlements).values({
    betId,
    kind: 'winner_payout',
    winnerUserId: winnerId,
    loserUserId: loserId,
    potUsdc: String(stake * 2),
    grossWinnerUsdc: String(stake * 2),
    platformFeeUsdc: '0',
    netWinnerUsdc: String(stake * 2),
    ledgerTxnId: randomUUID(),
  });
}

async function scoreOf(userId: string) {
  const [row] = await harness.db.select().from(riskScores).where(eq(riskScores.userId, userId));
  return row;
}
async function openAlertTypes(): Promise<string[]> {
  const rows = await harness.db
    .select({ type: riskAlerts.type })
    .from(riskAlerts)
    .where(eq(riskAlerts.status, 'open'));
  return rows.map((r: { type: string }) => r.type);
}

describe('ring detection (closed cluster)', () => {
  it('forms a ring cluster and flags it for a tight, repeated group', async () => {
    const [a, b, c, d] = [await makeUser(), await makeUser(), await makeUser(), await makeUser()];
    // Chain of strong edges (≥2 shared bets each) → one connected cluster of 4.
    for (const [x, y] of [
      [a, b],
      [b, c],
      [c, d],
    ] as const) {
      await createActiveBet(harness.db, { creatorUserId: x.id, acceptorUserId: y.id });
      await createActiveBet(harness.db, { creatorUserId: y.id, acceptorUserId: x.id });
    }

    await runRiskCycle(harness.db, { full: true });

    const sa = await scoreOf(a.id);
    expect(sa!.ringClusterId).not.toBeNull();
    expect(sa!.ringScore).toBeGreaterThanOrEqual(60);
    expect(await openAlertTypes()).toContain('ring');
  });
});

describe('false positive: legitimate diverse user', () => {
  it('a user with many distinct one-off counterparties is not flagged', async () => {
    const whale = await makeUser();
    for (let i = 0; i < 8; i++) {
      const opp = await makeUser();
      await createActiveBet(harness.db, { creatorUserId: whale.id, acceptorUserId: opp.id });
    }
    await runRiskCycle(harness.db, { full: true });

    const s = await scoreOf(whale.id);
    expect(s!.ringClusterId).toBeNull(); // no repeated pair → no strong edge → no cluster
    expect(s!.ringScore).toBe(0);
    expect(['none', 'low']).toContain(s!.riskBand);
  });
});

describe('wash trading', () => {
  it('flags reciprocal round-trips with near-zero net exposure', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const ids: Array<{ id: string; creator: string }> = [];
    for (let i = 0; i < 8; i++) {
      const id1 = await createActiveBet(harness.db, { creatorUserId: a.id, acceptorUserId: b.id });
      const id2 = await createActiveBet(harness.db, { creatorUserId: b.id, acceptorUserId: a.id });
      ids.push({ id: id1, creator: a.id }, { id: id2, creator: b.id });
    }
    // Settle balanced: alternate winners so net exposure ≈ 0.
    for (let i = 0; i < ids.length; i++) {
      const winner = i % 2 === 0 ? a.id : b.id;
      const loser = winner === a.id ? b.id : a.id;
      await settle(ids[i]!.id, winner, loser);
    }

    await runRiskCycle(harness.db, { full: true });

    const s = await scoreOf(a.id);
    expect(s!.washScore).toBeGreaterThanOrEqual(60);
    expect(await openAlertTypes()).toContain('wash_trade');
  });
});

describe('dispute abuse', () => {
  it('flags a high frivolous, disproportionate disputer', async () => {
    const abuser = await makeUser();
    const victim = await makeUser();
    for (let i = 0; i < 5; i++) {
      const betId = await createActiveBet(harness.db, {
        creatorUserId: abuser.id,
        acceptorUserId: victim.id,
      });
      await harness.db.insert(disputes).values({
        betId,
        openerUserId: abuser.id,
        claimedWinnerUserId: abuser.id,
        reason: 'test',
        depositUsdc: '1',
        status: 'rejected',
      });
    }
    await runRiskCycle(harness.db, { full: true });

    const s = await scoreOf(abuser.id);
    expect(s!.abuseScore).toBeGreaterThanOrEqual(60);
    expect(await openAlertTypes()).toContain('dispute_abuse');
  });
});

describe('velocity — false-positive guard + spike', () => {
  it('a brand-new burst account has no velocity signal (no baseline)', async () => {
    const v = await makeUser();
    for (let i = 0; i < 12; i++) {
      const opp = await makeUser();
      await createActiveBet(harness.db, { creatorUserId: v.id, acceptorUserId: opp.id });
    }
    await runRiskCycle(harness.db, { full: true });
    expect((await scoreOf(v.id))!.velocityScore).toBe(0);
  });

  it('flags a real spike against an established baseline', async () => {
    const v = await makeUser();
    const baselineIds: string[] = [];
    for (let i = 0; i < 6; i++) {
      const opp = await makeUser();
      baselineIds.push(await createActiveBet(harness.db, { creatorUserId: v.id, acceptorUserId: opp.id }));
    }
    // Backdate the baseline bets into the trailing window.
    await harness.db
      .update(bets)
      .set({ createdAt: sql`now() - interval '20 days'` })
      .where(inArray(bets.id, baselineIds));
    for (let i = 0; i < 25; i++) {
      const opp = await makeUser();
      await createActiveBet(harness.db, { creatorUserId: v.id, acceptorUserId: opp.id });
    }
    await runRiskCycle(harness.db, { full: true });
    expect((await scoreOf(v.id))!.velocityScore).toBeGreaterThan(0);
  });
});

describe('funding overlap is supporting-only', () => {
  it('shared funding alone never raises risk above low', async () => {
    const u1 = await makeUser();
    const u2 = await makeUser();
    const wallet = 'SharedFundingWallet1111111111111111111111';
    for (const u of [u1, u2]) {
      await harness.db.insert(deposits).values({
        userId: u.id,
        sourceWallet: wallet,
        txSignature: `tx_${randomUUID()}`,
        amountUsdc: '100',
        status: 'credited',
      });
    }
    await runRiskCycle(harness.db, { full: true });

    const s = await scoreOf(u1.id);
    expect(s!.fundingOverlapScore).toBeGreaterThan(0); // signal IS observed
    expect(['none', 'low']).toContain(s!.riskBand); // but never primary
  });
});

describe('isolation — risk engine never touches the money path', () => {
  it('a full recompute mutates no bets/settlements/balances/deposits rows', async () => {
    const a = await makeUser();
    const b = await makeUser();
    await createActiveBet(harness.db, { creatorUserId: a.id, acceptorUserId: b.id });
    await createActiveBet(harness.db, { creatorUserId: b.id, acceptorUserId: a.id });

    const count = async (table: string) => {
      const r = await harness.pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
      return r.rows[0]!.n;
    };
    const before = {
      bets: await count('app.bets'),
      settlements: await count('app.settlements'),
      balances: await count('financial.balances'),
      ledger: await count('financial.ledger_entries'),
      deposits: await count('financial.deposits'),
    };

    await runRiskCycle(harness.db, { full: true });

    expect({
      bets: await count('app.bets'),
      settlements: await count('app.settlements'),
      balances: await count('financial.balances'),
      ledger: await count('financial.ledger_entries'),
      deposits: await count('financial.deposits'),
    }).toEqual(before);
  });
});
