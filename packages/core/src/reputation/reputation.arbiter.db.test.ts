import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { betArbiters, disputes, reputationRecomputeQueue, userReputation } from '@rivlayx/db';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { createBet } from '../bets/create';
import { arbiterDeclineAssignment } from '../bets/arbiter';
import { baseSportsBetInput, fundUser, linkTestWallet } from '../bets/test-helpers';
import { gatherArbiterSignals } from './signals';
import { recomputeUserReputation } from './recompute';
import { listTopArbiters } from './arbiters';
import { getReputationAnalytics } from './analytics';

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
      'TRUNCATE financial.freeze_state CASCADE; ' +
      "INSERT INTO financial.freeze_state (component) VALUES ('new_bets'), ('settlements'), ('withdrawals'), ('all'); " +
      'TRUNCATE app.bets CASCADE;',
  );
});

async function makeUser() {
  const u = await createTestUser(harness.db);
  await linkTestWallet(harness.db, u.id);
  await fundUser(harness.db, u.id, '300');
  return u;
}

async function openBet(creatorId: string) {
  const { bet } = await createBet(harness.db, baseSportsBetInput(creatorId));
  return bet.id;
}

async function assign(
  betId: string,
  arbiterId: string,
  opts: { status: 'pending' | 'accepted' | 'declined'; ruled?: boolean },
) {
  await harness.db.insert(betArbiters).values({
    betId,
    arbiterUserId: arbiterId,
    selectedBy: 'user',
    status: opts.status,
    decision: opts.ruled ? { note: 'ruled' } : null,
    decidedAt: opts.status === 'pending' ? null : new Date(),
  });
}

async function upholdDispute(betId: string, openerId: string, claimedId: string) {
  await harness.db.insert(disputes).values({
    betId,
    openerUserId: openerId,
    claimedWinnerUserId: claimedId,
    reason: 'test',
    depositUsdc: '1',
    status: 'upheld',
  });
}

describe('gatherArbiterSignals', () => {
  it('counts accepted/declined, rulings (decision set) and overturned (upheld dispute)', async () => {
    const arb = await makeUser();
    const creator = await makeUser();

    const b0 = await openBet(creator.id);
    const b1 = await openBet(creator.id);
    const b2 = await openBet(creator.id);
    const b3 = await openBet(creator.id);
    const b4 = await openBet(creator.id);

    await assign(b0, arb.id, { status: 'accepted', ruled: true });
    await assign(b1, arb.id, { status: 'accepted', ruled: true });
    await assign(b2, arb.id, { status: 'accepted', ruled: true });
    await assign(b3, arb.id, { status: 'accepted', ruled: false });
    await assign(b4, arb.id, { status: 'declined' });
    await upholdDispute(b0, creator.id, creator.id); // overturns one ruling

    const s = await gatherArbiterSignals(harness.db, arb.id);
    expect(s.accepted).toBe(4);
    expect(s.declined).toBe(1);
    expect(s.rulings).toBe(3);
    expect(s.overturned).toBe(1);
  });
});

describe('recomputeUserReputation — arbiter columns', () => {
  it('persists arbiter score, tier, rates and rulings', async () => {
    const arb = await makeUser();
    const creator = await makeUser();
    for (let i = 0; i < 3; i++) {
      const b = await openBet(creator.id);
      await assign(b, arb.id, { status: 'accepted', ruled: true });
    }
    const b = await openBet(creator.id);
    await assign(b, arb.id, { status: 'accepted', ruled: true });
    await upholdDispute(b, creator.id, creator.id); // 1 of 4 overturned = 0.25

    await recomputeUserReputation(harness.db, arb.id);
    const [row] = await harness.db
      .select()
      .from(userReputation)
      .where(eq(userReputation.userId, arb.id));
    expect(row!.arbiterRulings).toBe(4);
    expect(row!.arbiterProvisional).toBe(false);
    expect(Number(row!.arbiterOverturnedRate)).toBeCloseTo(0.25, 2);
    expect(Number(row!.arbiterAcceptanceRate)).toBe(1);
    // 25% overturned → never trusted
    expect(row!.arbiterTier).not.toBe('trusted');
  });
});

describe('listTopArbiters + analytics', () => {
  it('lists arbiters publicly (no raw score) and reports overturned arbitrations', async () => {
    const arb = await makeUser();
    const creator = await makeUser();
    for (let i = 0; i < 3; i++) {
      const b = await openBet(creator.id);
      await assign(b, arb.id, { status: 'accepted', ruled: true });
    }
    const overturnedBet = await openBet(creator.id);
    await assign(overturnedBet, arb.id, { status: 'accepted', ruled: true });
    await upholdDispute(overturnedBet, creator.id, creator.id);
    await recomputeUserReputation(harness.db, arb.id);

    const top = await listTopArbiters(harness.db, { limit: 10 });
    expect(top.map((t) => t.userId)).toContain(arb.id);
    expect(top[0]).not.toHaveProperty('arbiterScore');

    const analytics = await getReputationAnalytics(harness.db);
    expect(analytics.topArbiters.map((t) => t.userId)).toContain(arb.id);
    expect(analytics.overturnedArbiters.some((o) => o.username === arb.username)).toBe(true);
  });
});

describe('arbiter hooks', () => {
  it('declining an assignment enqueues a reputation refresh', async () => {
    const arb = await makeUser();
    const creator = await makeUser();
    const betId = await openBet(creator.id);
    await assign(betId, arb.id, { status: 'pending' });

    await arbiterDeclineAssignment(harness.db, { betId, arbiterUserId: arb.id });

    const [row] = await harness.db
      .select()
      .from(reputationRecomputeQueue)
      .where(eq(reputationRecomputeQueue.userId, arb.id));
    expect(row?.reason).toBe('arbiter_action');
  });
});
