import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { getMarketplaceBet, resolutionMethod } from './detail';
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

describe('getMarketplaceBet — resolution', () => {
  it('resolves by UUID, short code, and share slug', async () => {
    const { id, shortCode } = await seedBet(harness.db, { creatorUserId: userId, title: 'findme' });
    expect((await getMarketplaceBet(harness.db, id))?.title).toBe('findme');
    expect((await getMarketplaceBet(harness.db, shortCode))?.id).toBe(id);
    // canonical share link slug === short code
    expect((await getMarketplaceBet(harness.db, shortCode))?.shortCode).toBe(shortCode);
  });

  it('returns null for unknown id and for a random non-existent code', async () => {
    expect(await getMarketplaceBet(harness.db, '00000000-0000-0000-0000-000000000000')).toBeNull();
    expect(await getMarketplaceBet(harness.db, 'NoSuchCode99')).toBeNull();
  });

  it('hides DRAFT bets', async () => {
    const { shortCode } = await seedBet(harness.db, { creatorUserId: userId, status: 'DRAFT' });
    expect(await getMarketplaceBet(harness.db, shortCode)).toBeNull();
  });
});

describe('getMarketplaceBet — payload', () => {
  it('includes rules, participants, category, pot, timestamps, and resolution method', async () => {
    const acceptor = await createTestUser(harness.db);
    const { id } = await seedBet(harness.db, {
      creatorUserId: userId,
      acceptorUserId: acceptor.id,
      title: 'detailed',
      templateId: 'crypto.price_above',
      resolveType: 'auto',
      resolveSource: { provider: 'coingecko', externalEventId: 'bitcoin' },
      stakePerSideUsdc: '15',
      status: 'ACTIVE',
      ruleDisplay: 'BTC above 100000 by deadline',
    });

    const detail = await getMarketplaceBet(harness.db, id);
    expect(detail).not.toBeNull();
    expect(detail!.category).toBe('crypto');
    expect(detail!.potUsdc).toBe('30.000000');
    expect(detail!.resolutionMethod).toBe('Automatic — coingecko');
    expect(detail!.rules).toHaveLength(1);
    expect(detail!.rules[0]!.display).toBe('BTC above 100000 by deadline');
    expect(detail!.participants.length).toBeGreaterThanOrEqual(1);
    expect(detail!.participants[0]!.role).toBe('creator');
    expect(detail!.createdAt).toBeInstanceOf(Date);
    expect(detail!.sharePath).toBe(`/b/${detail!.shortCode}`);
  });
});

describe('resolutionMethod', () => {
  it('renders each resolve type', () => {
    expect(resolutionMethod('auto', 'none', { provider: 'api_football' })).toBe('Automatic — api_football');
    expect(resolutionMethod('auto', 'none', null)).toBe('Automatic (provider feed)');
    expect(resolutionMethod('evidence', 'none', null)).toBe('Evidence-based');
    expect(resolutionMethod('arbiter', 'user_selected', null)).toBe('Arbiter — user-selected');
    expect(resolutionMethod('arbiter', 'platform_selected', null)).toBe('Arbiter — platform-selected');
  });
});
