import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { listMarketplaceBets, potUsdc } from './query';
import { seedBet } from './test-helpers';

let harness: TestDb;
let userId: string;

const NOW = new Date('2030-01-01T00:00:00Z');
const future = (ms: number) => new Date(NOW.getTime() + ms);
const past = (ms: number) => new Date(NOW.getTime() - ms);
const DAY = 86_400_000;

beforeAll(async () => {
  harness = await createTestDb();
});
afterAll(async () => {
  await harness.close();
});
beforeEach(async () => {
  await harness.pg.exec('TRUNCATE auth.users CASCADE; TRUNCATE app.bets CASCADE;');
  const user = await createTestUser(harness.db);
  userId = user.id;
});

describe('listMarketplaceBets — visibility', () => {
  it('returns only OPEN, not-yet-expired bets', async () => {
    await seedBet(harness.db, { creatorUserId: userId, title: 'open-future', expiresAt: future(DAY) });
    await seedBet(harness.db, { creatorUserId: userId, title: 'open-null', expiresAt: null });
    await seedBet(harness.db, { creatorUserId: userId, title: 'open-expired', expiresAt: past(DAY) });
    await seedBet(harness.db, { creatorUserId: userId, title: 'active', status: 'ACTIVE', expiresAt: future(DAY) });
    await seedBet(harness.db, { creatorUserId: userId, title: 'resolved', status: 'RESOLVED' });

    const res = await listMarketplaceBets(harness.db, { now: NOW });
    const titles = res.items.map((i) => i.title).sort();
    expect(titles).toEqual(['open-future', 'open-null']);
    expect(res.total).toBe(2);
  });
});

describe('listMarketplaceBets — search', () => {
  it('matches title and description case-insensitively', async () => {
    await seedBet(harness.db, { creatorUserId: userId, title: 'Lakers vs Celtics', expiresAt: future(DAY) });
    await seedBet(harness.db, {
      creatorUserId: userId,
      title: 'Crypto call',
      description: 'Bitcoin to the moon',
      expiresAt: future(DAY),
    });
    await seedBet(harness.db, { creatorUserId: userId, title: 'Tennis final', expiresAt: future(DAY) });

    expect((await listMarketplaceBets(harness.db, { q: 'lakers', now: NOW })).items.map((i) => i.title)).toEqual([
      'Lakers vs Celtics',
    ]);
    expect((await listMarketplaceBets(harness.db, { q: 'BITCOIN', now: NOW })).items.map((i) => i.title)).toEqual([
      'Crypto call',
    ]);
    expect((await listMarketplaceBets(harness.db, { q: 'nomatch', now: NOW })).total).toBe(0);
  });

  it('treats % and _ as literals, not wildcards', async () => {
    await seedBet(harness.db, { creatorUserId: userId, title: '100% sure', expiresAt: future(DAY) });
    await seedBet(harness.db, { creatorUserId: userId, title: 'plain', expiresAt: future(DAY) });
    expect((await listMarketplaceBets(harness.db, { q: '%', now: NOW })).items.map((i) => i.title)).toEqual([
      '100% sure',
    ]);
  });
});

describe('listMarketplaceBets — category facets', () => {
  beforeEach(async () => {
    await seedBet(harness.db, { creatorUserId: userId, title: 'football', templateId: 'football.match_winner', expiresAt: future(DAY) });
    await seedBet(harness.db, { creatorUserId: userId, title: 'tennis', templateId: 'tennis.match_winner', expiresAt: future(DAY) });
    await seedBet(harness.db, {
      creatorUserId: userId,
      title: 'crypto',
      templateId: 'crypto.price_above',
      resolveType: 'auto',
      expiresAt: future(DAY),
    });
    await seedBet(harness.db, {
      creatorUserId: userId,
      title: 'freeform',
      betType: 'open_objective',
      templateId: null,
      resolveType: 'evidence',
      expiresAt: future(DAY),
    });
  });

  it('filters sport', async () => {
    const res = await listMarketplaceBets(harness.db, { category: 'sport', now: NOW });
    expect(res.items.map((i) => i.title).sort()).toEqual(['football', 'tennis']);
  });
  it('filters crypto', async () => {
    const res = await listMarketplaceBets(harness.db, { category: 'crypto', now: NOW });
    expect(res.items.map((i) => i.title)).toEqual(['crypto']);
    expect(res.items[0]!.category).toBe('crypto');
  });
  it('filters open_objective', async () => {
    const res = await listMarketplaceBets(harness.db, { category: 'open_objective', now: NOW });
    expect(res.items.map((i) => i.title)).toEqual(['freeform']);
    expect(res.items[0]!.category).toBe('open_objective');
  });
  it('filters a specific sport', async () => {
    const res = await listMarketplaceBets(harness.db, { sport: 'tennis', now: NOW });
    expect(res.items.map((i) => i.title)).toEqual(['tennis']);
  });
});

describe('listMarketplaceBets — resolve-type + stake filters', () => {
  beforeEach(async () => {
    await seedBet(harness.db, { creatorUserId: userId, title: 'auto-5', resolveType: 'auto', stakePerSideUsdc: '5', expiresAt: future(DAY) });
    await seedBet(harness.db, { creatorUserId: userId, title: 'evidence-10', resolveType: 'evidence', stakePerSideUsdc: '10', expiresAt: future(DAY) });
    await seedBet(harness.db, { creatorUserId: userId, title: 'arbiter-20', resolveType: 'arbiter', arbiterType: 'user_selected', stakePerSideUsdc: '20', expiresAt: future(DAY) });
  });

  it('filters by resolve type', async () => {
    expect((await listMarketplaceBets(harness.db, { resolveType: 'evidence', now: NOW })).items.map((i) => i.title)).toEqual([
      'evidence-10',
    ]);
  });
  it('filters by min stake', async () => {
    expect((await listMarketplaceBets(harness.db, { minStake: 10, now: NOW })).items.map((i) => i.title).sort()).toEqual([
      'arbiter-20',
      'evidence-10',
    ]);
  });
  it('filters by max stake', async () => {
    expect((await listMarketplaceBets(harness.db, { maxStake: '10', now: NOW })).items.map((i) => i.title).sort()).toEqual([
      'auto-5',
      'evidence-10',
    ]);
  });
  it('filters by stake range', async () => {
    expect((await listMarketplaceBets(harness.db, { minStake: 8, maxStake: 15, now: NOW })).items.map((i) => i.title)).toEqual([
      'evidence-10',
    ]);
  });
});

describe('listMarketplaceBets — sorting', () => {
  it('newest orders by createdAt desc', async () => {
    await seedBet(harness.db, { creatorUserId: userId, title: 'old', createdAt: past(3 * DAY), expiresAt: future(DAY) });
    await seedBet(harness.db, { creatorUserId: userId, title: 'mid', createdAt: past(2 * DAY), expiresAt: future(DAY) });
    await seedBet(harness.db, { creatorUserId: userId, title: 'new', createdAt: past(DAY), expiresAt: future(DAY) });
    const res = await listMarketplaceBets(harness.db, { section: 'newest', now: NOW });
    expect(res.items.map((i) => i.title)).toEqual(['new', 'mid', 'old']);
  });

  it('highest_stakes orders by stake desc', async () => {
    await seedBet(harness.db, { creatorUserId: userId, title: 's5', stakePerSideUsdc: '5', expiresAt: future(DAY) });
    await seedBet(harness.db, { creatorUserId: userId, title: 's25', stakePerSideUsdc: '25', expiresAt: future(DAY) });
    await seedBet(harness.db, { creatorUserId: userId, title: 's12', stakePerSideUsdc: '12.5', expiresAt: future(DAY) });
    const res = await listMarketplaceBets(harness.db, { section: 'highest_stakes', now: NOW });
    expect(res.items.map((i) => i.title)).toEqual(['s25', 's12', 's5']);
  });

  it('expiring_soon orders by expiresAt asc and excludes null deadlines', async () => {
    await seedBet(harness.db, { creatorUserId: userId, title: 'soon', expiresAt: future(DAY) });
    await seedBet(harness.db, { creatorUserId: userId, title: 'later', expiresAt: future(5 * DAY) });
    await seedBet(harness.db, { creatorUserId: userId, title: 'nodeadline', expiresAt: null });
    const res = await listMarketplaceBets(harness.db, { section: 'expiring_soon', now: NOW });
    expect(res.items.map((i) => i.title)).toEqual(['soon', 'later']);
  });

  it('trending ranks high engagement first, recency breaks ties', async () => {
    await seedBet(harness.db, { creatorUserId: userId, title: 'hot', clicks: 50, conversions: 10, createdAt: past(5 * DAY), expiresAt: future(DAY) });
    await seedBet(harness.db, { creatorUserId: userId, title: 'quiet-new', clicks: 0, conversions: 0, createdAt: past(1000), expiresAt: future(DAY) });
    await seedBet(harness.db, { creatorUserId: userId, title: 'quiet-old', clicks: 0, conversions: 0, createdAt: past(10 * DAY), expiresAt: future(DAY) });
    const res = await listMarketplaceBets(harness.db, { section: 'trending', now: NOW });
    expect(res.items[0]!.title).toBe('hot');
    // Equal (zero) engagement → fresher bet wins on the recency boost.
    expect(res.items.map((i) => i.title).indexOf('quiet-new')).toBeLessThan(
      res.items.map((i) => i.title).indexOf('quiet-old'),
    );
  });
});

describe('listMarketplaceBets — pagination + shape', () => {
  it('paginates with total + hasMore', async () => {
    for (let i = 0; i < 5; i++) {
      await seedBet(harness.db, { creatorUserId: userId, title: `b${i}`, createdAt: past(i * DAY + DAY), expiresAt: future(DAY) });
    }
    const p1 = await listMarketplaceBets(harness.db, { page: 1, pageSize: 2, now: NOW });
    expect(p1.items).toHaveLength(2);
    expect(p1.total).toBe(5);
    expect(p1.hasMore).toBe(true);

    const p3 = await listMarketplaceBets(harness.db, { page: 3, pageSize: 2, now: NOW });
    expect(p3.items).toHaveLength(1);
    expect(p3.hasMore).toBe(false);
  });

  it('exposes pot size, share path, and category on each item', async () => {
    await seedBet(harness.db, { creatorUserId: userId, title: 'shape', stakePerSideUsdc: '12.5', expiresAt: future(DAY) });
    const [item] = (await listMarketplaceBets(harness.db, { now: NOW })).items;
    expect(item!.potUsdc).toBe('25.000000');
    expect(item!.sharePath).toBe(`/b/${item!.shortCode}`);
    expect(item!.category).toBe('football');
  });

  it('clamps page size to the max', async () => {
    const res = await listMarketplaceBets(harness.db, { pageSize: 9999, now: NOW });
    expect(res.pageSize).toBe(100);
  });
});

describe('potUsdc', () => {
  it('doubles the stake with 6dp', () => {
    expect(potUsdc('10')).toBe('20.000000');
    expect(potUsdc('12.5')).toBe('25.000000');
  });
});
