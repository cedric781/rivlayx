import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { recordShareLinkClick, recordShareLinkConversion } from './share';
import { listMarketplaceBets } from './query';
import { seedBet } from './test-helpers';

let harness: TestDb;
let userId: string;

beforeAll(async () => {
  harness = await createTestDb();
});
afterAll(async () => {
  await harness.close();
});
beforeEach(async () => {
  await harness.pg.exec('TRUNCATE auth.users CASCADE; TRUNCATE app.bets CASCADE;');
  userId = (await createTestUser(harness.db)).id;
});

describe('recordShareLinkClick', () => {
  it('increments clicks atomically and returns the engagement', async () => {
    const { shortCode } = await seedBet(harness.db, { creatorUserId: userId });
    const first = await recordShareLinkClick(harness.db, shortCode);
    expect(first?.clicks).toBe(1);
    const second = await recordShareLinkClick(harness.db, shortCode);
    expect(second?.clicks).toBe(2);
  });

  it('returns null for an unknown slug', async () => {
    expect(await recordShareLinkClick(harness.db, 'does-not-exist')).toBeNull();
  });

  it('feeds the trending ranking', async () => {
    const a = await seedBet(harness.db, { creatorUserId: userId, title: 'a', expiresAt: new Date(Date.now() + 86_400_000) });
    await seedBet(harness.db, { creatorUserId: userId, title: 'b', expiresAt: new Date(Date.now() + 86_400_000) });
    for (let i = 0; i < 10; i++) await recordShareLinkClick(harness.db, a.shortCode);
    const res = await listMarketplaceBets(harness.db, { section: 'trending' });
    expect(res.items[0]!.title).toBe('a');
  });
});

describe('recordShareLinkConversion', () => {
  it('increments conversions atomically', async () => {
    const { shortCode } = await seedBet(harness.db, { creatorUserId: userId });
    const r = await recordShareLinkConversion(harness.db, shortCode);
    expect(r?.conversions).toBe(1);
    expect(r?.clicks).toBe(0);
  });
});
