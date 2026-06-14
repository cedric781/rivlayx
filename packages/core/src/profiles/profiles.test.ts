import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { bets, users } from '@rivlayx/db';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { createBet } from '../bets/create';
import { settleBet } from '../bets/settle';
import {
  baseSportsBetInput,
  createActiveBet,
  createBetAwaitingResult,
  fundUser,
  futureIso,
  linkTestWallet,
} from '../bets/test-helpers';
import { getProfileStats } from './stats';
import { listProfileBets } from './history';
import { getPublicUserByUsername } from './lookup';
import { generateUniqueUsername } from './username';

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

async function makeUser(username?: string) {
  const u = await createTestUser(harness.db, username ? { username } : {});
  await linkTestWallet(harness.db, u.id);
  await fundUser(harness.db, u.id, '300');
  return u;
}

/** Create an ACTIVE bet then settle it to a winner (or draw if winner=null). */
async function createSettledBet(
  creatorId: string,
  acceptorId: string,
  winnerId: string | null,
  stake = '10',
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

describe('getProfileStats', () => {
  it('aggregates wins, losses, win rate, volume, winnings and counts', async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const carol = await makeUser();

    // 1 open (alice only), 1 active, 1 awaiting, 1 won, 1 lost, 1 draw — all stake 10
    await createBet(harness.db, {
      ...baseSportsBetInput(alice.id),
      stakePerSideUsdc: '10',
    });
    await createActiveBet(harness.db, { creatorUserId: alice.id, acceptorUserId: bob.id });
    await createBetAwaitingResult(harness.db, { creatorUserId: alice.id, acceptorUserId: bob.id });
    await createSettledBet(alice.id, bob.id, alice.id); // won
    await createSettledBet(alice.id, carol.id, carol.id); // lost
    await createSettledBet(alice.id, bob.id, null); // draw

    const stats = await getProfileStats(harness.db, alice.id);

    expect(stats.totalBets).toBe(6);
    expect(stats.openBets).toBe(1);
    expect(stats.activeBets).toBe(1);
    expect(stats.wins).toBe(1);
    expect(stats.losses).toBe(1);
    expect(stats.winRate).toBe(0.5);
    expect(stats.totalVolumeUsdc).toBe('60.000000');
    // won: stake 10, pot 20, fee 2.5% = 0.5, net 19.5, profit = 9.5
    expect(stats.totalWinningsUsdc).toBe('9.500000');
    // lost: own stake 10
    expect(stats.totalLossesUsdc).toBe('10.000000');
  });

  it('returns zeroed stats and 0 win rate for a user with no bets', async () => {
    const loner = await makeUser();
    const stats = await getProfileStats(harness.db, loner.id);
    expect(stats).toMatchObject({
      totalBets: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      totalVolumeUsdc: '0.000000',
      totalWinningsUsdc: '0.000000',
      totalLossesUsdc: '0.000000',
      activeBets: 0,
      openBets: 0,
    });
  });
});

describe('listProfileBets', () => {
  it('filters by lifecycle bucket and tags the user outcome', async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const carol = await makeUser();

    await createBet(harness.db, { ...baseSportsBetInput(alice.id) });
    await createActiveBet(harness.db, { creatorUserId: alice.id, acceptorUserId: bob.id });
    await createSettledBet(alice.id, bob.id, alice.id); // won
    await createSettledBet(alice.id, carol.id, carol.id); // lost

    const all = await listProfileBets(harness.db, alice.id, { filter: 'all' });
    expect(all.total).toBe(4);

    const open = await listProfileBets(harness.db, alice.id, { filter: 'open' });
    expect(open.total).toBe(1);
    expect(open.items[0]!.status).toBe('OPEN');

    const won = await listProfileBets(harness.db, alice.id, { filter: 'won' });
    expect(won.total).toBe(1);
    expect(won.items[0]!.result).toBe('won');

    const lost = await listProfileBets(harness.db, alice.id, { filter: 'lost' });
    expect(lost.total).toBe(1);
    expect(lost.items[0]!.result).toBe('lost');
  });

  it('sorts by highest stake / pot', async () => {
    const alice = await makeUser();
    await createBet(harness.db, { ...baseSportsBetInput(alice.id), stakePerSideUsdc: '5' });
    await createBet(harness.db, { ...baseSportsBetInput(alice.id), stakePerSideUsdc: '20' });
    await createBet(harness.db, { ...baseSportsBetInput(alice.id), stakePerSideUsdc: '12' });

    const byStake = await listProfileBets(harness.db, alice.id, { sort: 'highest_stake' });
    expect(byStake.items.map((b) => b.userStakeUsdc)).toEqual([
      '20.000000',
      '12.000000',
      '5.000000',
    ]);

    const byPot = await listProfileBets(harness.db, alice.id, { sort: 'highest_pot' });
    expect(byPot.items.map((b) => b.potUsdc)).toEqual(['40.000000', '24.000000', '10.000000']);
  });

  it('paginates', async () => {
    const alice = await makeUser();
    for (let i = 0; i < 3; i++) {
      await createBet(harness.db, { ...baseSportsBetInput(alice.id), expiresAt: futureIso(86_400_000) });
    }
    const p1 = await listProfileBets(harness.db, alice.id, { pageSize: 2, page: 1 });
    expect(p1.items).toHaveLength(2);
    expect(p1.total).toBe(3);
    expect(p1.hasMore).toBe(true);

    const p2 = await listProfileBets(harness.db, alice.id, { pageSize: 2, page: 2 });
    expect(p2.items).toHaveLength(1);
    expect(p2.hasMore).toBe(false);
  });
});

describe('username helpers', () => {
  it('generateUniqueUsername normalizes and de-duplicates', async () => {
    const first = await generateUniqueUsername(harness.db, 'John.Doe');
    expect(first).toBe('johndoe');
    await createTestUser(harness.db, { username: first });

    const second = await generateUniqueUsername(harness.db, 'John.Doe');
    expect(second).toBe('johndoe2');
    expect(second).not.toBe(first);
  });

  it('getPublicUserByUsername returns public fields only, excludes banned', async () => {
    const u = await createTestUser(harness.db, { username: 'visible_one' });
    const summary = await getPublicUserByUsername(harness.db, 'visible_one');
    expect(summary).toMatchObject({ id: u.id, username: 'visible_one' });
    // public summary must not leak email / privyId
    expect(summary as unknown as Record<string, unknown>).not.toHaveProperty('email');
    expect(summary as unknown as Record<string, unknown>).not.toHaveProperty('privyId');

    await harness.db.update(users).set({ status: 'banned' }).where(eq(users.id, u.id));
    expect(await getPublicUserByUsername(harness.db, 'visible_one')).toBeNull();
  });
});
