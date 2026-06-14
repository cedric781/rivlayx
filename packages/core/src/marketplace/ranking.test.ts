import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { userReputation } from '@rivlayx/db';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { createBet } from '../bets/create';
import { baseSportsBetInput, fundUser, linkTestWallet } from '../bets/test-helpers';
import { listMarketplaceBets } from './query';

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

async function makeCreator(tier?: 'trusted' | 'gold' | 'silver' | 'bronze') {
  const u = await createTestUser(harness.db);
  await linkTestWallet(harness.db, u.id);
  await fundUser(harness.db, u.id, '200');
  if (tier) {
    await harness.db
      .insert(userReputation)
      .values({ userId: u.id, score: 90, tier, provisional: false });
  }
  return u;
}

async function openBet(creatorId: string) {
  const { bet } = await createBet(harness.db, baseSportsBetInput(creatorId));
  return bet.id;
}

describe('marketplace exact tier filter', () => {
  it('returns only bets whose creator matches the exact tier', async () => {
    const trusted = await makeCreator('trusted');
    const newbie = await makeCreator(); // no snapshot → treated as "new"
    const trustedBet = await openBet(trusted.id);
    const newBet = await openBet(newbie.id);

    const onlyTrusted = await listMarketplaceBets(harness.db, { tier: 'trusted' });
    expect(onlyTrusted.items.map((b) => b.id)).toEqual([trustedBet]);

    const onlyNew = await listMarketplaceBets(harness.db, { tier: 'new' });
    expect(onlyNew.items.map((b) => b.id)).toEqual([newBet]);

    const onlyGold = await listMarketplaceBets(harness.db, { tier: 'gold' });
    expect(onlyGold.items).toHaveLength(0);
  });
});

describe('marketplace trending reputation boost', () => {
  it('ranks a higher-tier creator above a newer low-tier bet', async () => {
    const trusted = await makeCreator('trusted');
    const newbie = await makeCreator();
    // Trusted bet created FIRST (older); new-tier bet created SECOND (newer).
    // Without the boost the newer bet would win on recency; the boost flips it.
    const trustedBet = await openBet(trusted.id);
    const newBet = await openBet(newbie.id);

    const trending = await listMarketplaceBets(harness.db, { section: 'trending' });
    const ids = trending.items.map((b) => b.id);
    expect(ids.indexOf(trustedBet)).toBeLessThan(ids.indexOf(newBet));
    expect(ids[0]).toBe(trustedBet);
  });
});
