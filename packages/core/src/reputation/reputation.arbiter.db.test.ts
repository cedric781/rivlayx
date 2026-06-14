import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { betArbiters, disputes, reputationRecomputeQueue, userReputation } from '@rivlayx/db';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { arbiterDeclineAssignment } from '../bets/arbiter';
import { createActiveBet, fundUser, linkTestWallet } from '../bets/test-helpers';
import { gatherArbiterSignals } from './signals';
import { computeArbiterReputation } from './score';
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
  await fundUser(harness.db, u.id, '500');
  return u;
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

/** Active (matched) bet with a recorded arbiter ruling. */
async function ruledBet(
  arbiterId: string,
  creatorId: string,
  acceptorId: string,
  opts: { platform?: boolean; overturn?: boolean } = {},
) {
  const betId = await createActiveBet(harness.db, {
    creatorUserId: creatorId,
    acceptorUserId: acceptorId,
  });
  await harness.db.insert(betArbiters).values({
    betId,
    arbiterUserId: arbiterId,
    selectedBy: opts.platform ? 'platform' : 'creator',
    status: 'accepted',
    decision: { ruled: true },
    decidedAt: new Date(),
  });
  if (opts.overturn) await upholdDispute(betId, creatorId, acceptorId);
  return betId;
}

async function arbiterTier(arbiterId: string) {
  const signals = await gatherArbiterSignals(harness.db, arbiterId);
  return { signals, result: computeArbiterReputation(signals) };
}

describe('arbiter signals — distinct counting excludes the arbiter', () => {
  it('counts distinct creators and participants across ruled bets', async () => {
    const arb = await makeUser();
    const c1 = await makeUser();
    const c2 = await makeUser();
    const acc = await makeUser();
    await ruledBet(arb.id, c1.id, acc.id);
    await ruledBet(arb.id, c2.id, acc.id);

    const s = await gatherArbiterSignals(harness.db, arb.id);
    expect(s.rulings).toBe(2);
    expect(s.distinctCreators).toBe(2); // c1, c2
    expect(s.distinctParticipants).toBe(3); // c1, c2, acc
  });
});

describe('abuse: self-assigned arbiter farm', () => {
  it('cannot leave provisional when the arbiter rules their own bets', async () => {
    const arb = await makeUser();
    for (let i = 0; i < 11; i++) {
      const acc = await makeUser();
      await ruledBet(arb.id, arb.id, acc.id); // creator === arbiter → excluded
    }
    const { signals, result } = await arbiterTier(arb.id);
    expect(signals.rulings).toBe(11);
    expect(signals.distinctCreators).toBe(0);
    expect(result.arbiterProvisional).toBe(true);
    expect(result.arbiterTier).toBe('new');
  });
});

describe('abuse: creator alt farm', () => {
  it('cannot leave provisional when all ruled bets come from one creator', async () => {
    const arb = await makeUser();
    const creator = await makeUser();
    for (let i = 0; i < 11; i++) {
      const acc = await makeUser();
      await ruledBet(arb.id, creator.id, acc.id);
    }
    const { signals, result } = await arbiterTier(arb.id);
    expect(signals.distinctCreators).toBe(1);
    expect(result.arbiterTier).toBe('new');
  });
});

describe('abuse: repeated same counterparties', () => {
  it('cannot leave provisional when the same pair is reused', async () => {
    const arb = await makeUser();
    const creator = await makeUser();
    const acceptor = await makeUser();
    for (let i = 0; i < 11; i++) {
      await ruledBet(arb.id, creator.id, acceptor.id);
    }
    const { signals, result } = await arbiterTier(arb.id);
    expect(signals.distinctCreators).toBe(1);
    expect(signals.distinctParticipants).toBe(2);
    expect(result.arbiterTier).toBe('new');
  });
});

describe('trusted arbiter qualification', () => {
  it('reaches trusted with enough distinct creators/participants, rulings and clean record', async () => {
    const arb = await makeUser();
    for (let i = 0; i < 25; i++) {
      const creator = await makeUser();
      const acceptor = await makeUser();
      await ruledBet(arb.id, creator.id, acceptor.id);
    }
    await recomputeUserReputation(harness.db, arb.id);

    const [row] = await harness.db
      .select()
      .from(userReputation)
      .where(eq(userReputation.userId, arb.id));
    expect(row!.arbiterRulings).toBe(25);
    expect(row!.arbiterProvisional).toBe(false);
    expect(row!.arbiterTier).toBe('trusted');

    const top = await listTopArbiters(harness.db, { limit: 10 });
    expect(top.map((t) => t.userId)).toContain(arb.id);
    expect(top[0]).not.toHaveProperty('arbiterScore');

    const analytics = await getReputationAnalytics(harness.db);
    expect(analytics.topArbiters.map((t) => t.userId)).toContain(arb.id);
  });
});

describe('arbiter hooks', () => {
  it('declining an assignment enqueues a reputation refresh', async () => {
    const arb = await makeUser();
    const creator = await makeUser();
    const acceptor = await makeUser();
    const betId = await createActiveBet(harness.db, {
      creatorUserId: creator.id,
      acceptorUserId: acceptor.id,
    });
    await harness.db.insert(betArbiters).values({
      betId,
      arbiterUserId: arb.id,
      selectedBy: 'creator',
      status: 'pending',
    });

    await arbiterDeclineAssignment(harness.db, { betId, arbiterUserId: arb.id });

    const [row] = await harness.db
      .select()
      .from(reputationRecomputeQueue)
      .where(eq(reputationRecomputeQueue.userId, arb.id));
    expect(row?.reason).toBe('arbiter_action');
  });
});
