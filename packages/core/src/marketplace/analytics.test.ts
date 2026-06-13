import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { getCategoryAnalytics } from './analytics';
import { seedBet } from './test-helpers';

let harness: TestDb;
let userId: string;
let acceptorId: string;

beforeAll(async () => {
  harness = await createTestDb();
});
afterAll(async () => {
  await harness.close();
});
beforeEach(async () => {
  await harness.pg.exec('TRUNCATE auth.users CASCADE; TRUNCATE app.bets CASCADE;');
  userId = (await createTestUser(harness.db)).id;
  acceptorId = (await createTestUser(harness.db)).id;
});

describe('getCategoryAnalytics', () => {
  it('counts totals, accepted, and active per category', async () => {
    // football: 3 total, 2 accepted, 1 active(open)
    await seedBet(harness.db, { creatorUserId: userId, templateId: 'football.match_winner', status: 'ACTIVE', acceptorUserId: acceptorId });
    await seedBet(harness.db, { creatorUserId: userId, templateId: 'football.match_winner', status: 'SETTLED', acceptorUserId: acceptorId });
    await seedBet(harness.db, { creatorUserId: userId, templateId: 'football.match_winner', status: 'OPEN' });
    // crypto: 1 total, 0 accepted, 1 active(open)
    await seedBet(harness.db, { creatorUserId: userId, templateId: 'crypto.price_above', status: 'OPEN' });
    // open_objective: 1 total, 1 accepted, 1 active
    await seedBet(harness.db, { creatorUserId: userId, betType: 'open_objective', templateId: null, status: 'ACTIVE', acceptorUserId: acceptorId });

    const a = await getCategoryAnalytics(harness.db);
    const byCat = Object.fromEntries(a.perCategory.map((c) => [c.category, c]));

    expect(byCat['football']).toMatchObject({ total: 3, accepted: 2, active: 2 });
    expect(byCat['crypto']).toMatchObject({ total: 1, accepted: 0, active: 1 });
    expect(byCat['open_objective']).toMatchObject({ total: 1, accepted: 1, active: 1 });
  });

  it('reports most accepted and most active categories', async () => {
    await seedBet(harness.db, { creatorUserId: userId, templateId: 'football.match_winner', status: 'SETTLED', acceptorUserId: acceptorId });
    await seedBet(harness.db, { creatorUserId: userId, templateId: 'football.match_winner', status: 'SETTLED', acceptorUserId: acceptorId });
    await seedBet(harness.db, { creatorUserId: userId, templateId: 'tennis.match_winner', status: 'OPEN' });
    await seedBet(harness.db, { creatorUserId: userId, templateId: 'tennis.match_winner', status: 'OPEN' });
    await seedBet(harness.db, { creatorUserId: userId, templateId: 'tennis.match_winner', status: 'OPEN' });

    const a = await getCategoryAnalytics(harness.db);
    expect(a.mostAccepted?.category).toBe('football');
    expect(a.mostActive?.category).toBe('tennis');
  });

  it('returns null leaders when there are no bets', async () => {
    const a = await getCategoryAnalytics(harness.db);
    expect(a.perCategory).toEqual([]);
    expect(a.mostAccepted).toBeNull();
    expect(a.mostActive).toBeNull();
  });
});
