import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { bets, reputationRecomputeQueue, userReputation } from '@rivlayx/db';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { settleBet } from '../bets/settle';
import { banUser } from '../admin/moderation';
import { createActiveBet, fundUser, linkTestWallet } from '../bets/test-helpers';
import { gatherReputationSignals } from './signals';
import { recomputeUserReputation, runReputationWorker } from './recompute';
import { getReputation } from './query';

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

async function createSettledBet(
  creatorId: string,
  acceptorId: string,
  winnerId: string | null,
  stake: string,
) {
  const betId = await createActiveBet(harness.db, {
    creatorUserId: creatorId,
    acceptorUserId: acceptorId,
    overrides: { stakePerSideUsdc: stake },
  });
  await harness.db
    .update(bets)
    .set({ status: 'RESOLVED', resolvedWinnerUserId: winnerId })
    .where(eq(bets.id, betId));
  await settleBet(harness.db, { betId });
  return betId;
}

describe('gatherReputationSignals', () => {
  it('counts distinct counterparties, completed bets, wins/losses and capped volume', async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const carol = await makeUser();

    // 5 settled bets vs Bob at the 25 stake cap; Alice wins 4, loses 1.
    for (const winner of [alice.id, alice.id, alice.id, alice.id, bob.id]) {
      await createSettledBet(alice.id, bob.id, winner, '25');
    }
    // 1 settled bet vs Carol; Alice loses.
    await createSettledBet(alice.id, carol.id, carol.id, '25');

    const s = await gatherReputationSignals(harness.db, alice.id);
    expect(s.distinctCounterparties).toBe(2);
    expect(s.completedBets).toBe(6);
    expect(s.matchedBets).toBe(6);
    expect(s.wins).toBe(4);
    expect(s.losses).toBe(2);
    // Bob: 5 × 25 = 125 → capped at 100; Carol: 25 → total 125
    expect(Number(s.cappedSettledVolumeUsdc)).toBe(125);
  });
});

describe('recomputeUserReputation', () => {
  it('writes a snapshot and is idempotent', async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    await createSettledBet(alice.id, bob.id, alice.id, '20');

    const first = await recomputeUserReputation(harness.db, alice.id);
    const second = await recomputeUserReputation(harness.db, alice.id);
    expect(second.score).toBe(first.score);

    const [row] = await harness.db
      .select()
      .from(userReputation)
      .where(eq(userReputation.userId, alice.id));
    expect(row).toBeTruthy();
    expect(row!.score).toBe(first.score);
  });

  it('banned user scores 0', async () => {
    const admin = await makeUser();
    const target = await makeUser();
    await banUser(harness.db, { userId: target.id, actorUserId: admin.id, reason: 't' });
    const result = await recomputeUserReputation(harness.db, target.id);
    expect(result.score).toBe(0);
    expect(result.tier).toBe('untrusted');
  });
});

describe('event hooks → outbox', () => {
  it('settlement enqueues both participants; the worker drains and snapshots them', async () => {
    const d = await makeUser();
    const e = await makeUser();
    await createSettledBet(d.id, e.id, d.id, '20');

    const queuedBefore = await harness.db.select().from(reputationRecomputeQueue);
    const queuedIds = queuedBefore.map((r) => r.userId).sort();
    expect(queuedIds).toEqual([d.id, e.id].sort());
    expect(queuedBefore.every((r) => r.reason === 'settlement')).toBe(true);

    const res = await runReputationWorker(harness.db);
    expect(res.processed).toBe(2);

    const queuedAfter = await harness.db.select().from(reputationRecomputeQueue);
    expect(queuedAfter).toHaveLength(0);

    const dRep = await getReputation(harness.db, d.id);
    expect(dRep.tier).toBeTruthy();
  });

  it('ban enqueues a reinstate/ban refresh for the user', async () => {
    const admin = await makeUser();
    const target = await makeUser();
    await banUser(harness.db, { userId: target.id, actorUserId: admin.id, reason: 't' });
    const [row] = await harness.db
      .select()
      .from(reputationRecomputeQueue)
      .where(eq(reputationRecomputeQueue.userId, target.id));
    expect(row?.reason).toBe('ban');
  });
});

describe('getReputation', () => {
  it('returns a provisional "new" default when the user has no snapshot', async () => {
    const u = await makeUser();
    const rep = await getReputation(harness.db, u.id);
    expect(rep).toEqual({ tier: 'new', provisional: true });
  });
});
