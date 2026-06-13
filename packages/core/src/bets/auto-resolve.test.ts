import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { autoResolveAttempts, bets } from '@rivlayx/db';
import {
  MockApiFootballProvider,
  MockCoinGeckoProvider,
  ProviderRegistry,
} from '@rivlayx/providers';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import {
  closeExpiredDisputeWindows,
  resolvePendingBets,
  runAutoResolveCycle,
} from './auto-resolve';
import { proposeResult } from './resolve';
import { openDispute } from './dispute';
import { createBet } from './create';
import { acceptBet } from './accept';
import { fundUser, futureIso, linkTestWallet } from './test-helpers';
import type { CreateBetInput } from './types';

let harness: TestDb;
const REGISTRY_FACTORY = () => {
  const reg = new ProviderRegistry();
  const apiFootball = new MockApiFootballProvider();
  const coingecko = new MockCoinGeckoProvider();
  reg.register(apiFootball);
  reg.register(coingecko);
  return { reg, apiFootball, coingecko };
};

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
      'TRUNCATE app.bets CASCADE; TRUNCATE app.auto_resolve_attempts;',
  );
});

async function setupFootballBet(opts: {
  fixtureId: string;
  creatorSide: string;
  acceptorSide?: string;
  eventInPast?: boolean;
}) {
  const creator = await createTestUser(harness.db);
  const acceptor = await createTestUser(harness.db);
  await linkTestWallet(harness.db, creator.id);
  await linkTestWallet(harness.db, acceptor.id);
  await fundUser(harness.db, creator.id, '100');
  await fundUser(harness.db, acceptor.id, '100');

  const input: CreateBetInput = {
    creatorUserId: creator.id,
    betType: 'sports_template',
    templateId: 'football.match_winner',
    title: 'Sample',
    predicate: {
      type: 'team_wins',
      team: 'Home',
      eventReference: `apifootball:fixture:${opts.fixtureId}`,
    },
    resolveType: 'auto',
    resolveSource: { provider: 'api_football', externalEventId: opts.fixtureId },
    arbiterType: 'none',
    stakePerSideUsdc: '10',
    creatorSide: opts.creatorSide,
    expiresAt: futureIso(86_400_000),
    eventAt: futureIso(86_400_000 * 2),
  };
  const { bet } = await createBet(harness.db, input);
  await acceptBet(harness.db, {
    betId: bet.id,
    acceptorUserId: acceptor.id,
    acceptorSide: opts.acceptorSide ?? (opts.creatorSide === 'home' ? 'away' : 'home'),
  });
  if (opts.eventInPast !== false) {
    await harness.db.execute(
      sql`UPDATE "app"."bets" SET event_at = now() - interval '1 hour' WHERE id = ${bet.id}`,
    );
  }
  return { creator, acceptor, betId: bet.id };
}

describe('resolvePendingBets — happy path', () => {
  it('proposes the result when fixture is finished and event_at is past', async () => {
    const { creator, betId } = await setupFootballBet({ fixtureId: '101', creatorSide: 'home' });
    const { reg, apiFootball } = REGISTRY_FACTORY();
    apiFootball.setFixture({
      fixtureId: '101',
      statusShort: 'FT',
      homeName: 'Home',
      awayName: 'Away',
      homeGoals: 2,
      awayGoals: 1,
    });

    const results = await resolvePendingBets(harness.db, reg);
    expect(results).toHaveLength(1);
    expect(results[0]!.status).toBe('proposed');
    expect(results[0]!.winnerUserId).toBe(creator.id);

    const [b] = await harness.db.select().from(bets).where(eq(bets.id, betId));
    expect(b?.status).toBe('AWAITING_RESULT');
    expect(b?.proposedWinnerUserId).toBe(creator.id);

    const attempts = await harness.db
      .select()
      .from(autoResolveAttempts)
      .where(eq(autoResolveAttempts.betId, betId));
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.status).toBe('final');
  });

  it('routes win to acceptor when winningSide matches their pick', async () => {
    const { acceptor, betId } = await setupFootballBet({ fixtureId: '102', creatorSide: 'home' });
    const { reg, apiFootball } = REGISTRY_FACTORY();
    apiFootball.setFixture({
      fixtureId: '102',
      statusShort: 'FT',
      homeName: 'A',
      awayName: 'B',
      homeGoals: 0,
      awayGoals: 2,
    });
    const results = await resolvePendingBets(harness.db, reg);
    expect(results[0]!.winnerUserId).toBe(acceptor.id);
    const [b] = await harness.db.select().from(bets).where(eq(bets.id, betId));
    expect(b?.proposedWinnerUserId).toBe(acceptor.id);
  });
});

describe('resolvePendingBets — pending / cancelled / error paths', () => {
  it('leaves bet alone and logs pending when fixture not yet finished', async () => {
    const { betId } = await setupFootballBet({ fixtureId: '103', creatorSide: 'home' });
    const { reg, apiFootball } = REGISTRY_FACTORY();
    apiFootball.setFixture({
      fixtureId: '103',
      statusShort: '1H',
      homeName: 'A',
      awayName: 'B',
      homeGoals: 1,
      awayGoals: 0,
    });
    const results = await resolvePendingBets(harness.db, reg);
    expect(results[0]!.status).toBe('still_pending');
    const [b] = await harness.db.select().from(bets).where(eq(bets.id, betId));
    // Bet was moved to AWAITING_RESULT (event_at past) but no proposal yet.
    expect(b?.status).toBe('AWAITING_RESULT');
    expect(b?.proposedWinnerUserId).toBeNull();

    const attempts = await harness.db
      .select()
      .from(autoResolveAttempts)
      .where(eq(autoResolveAttempts.betId, betId));
    expect(attempts[0]!.status).toBe('pending');
  });

  it('flags cancelled-event status without voiding the bet', async () => {
    const { betId } = await setupFootballBet({ fixtureId: '104', creatorSide: 'home' });
    const { reg, apiFootball } = REGISTRY_FACTORY();
    apiFootball.setFixture({
      fixtureId: '104',
      statusShort: 'CANC',
      homeName: 'A',
      awayName: 'B',
      homeGoals: 0,
      awayGoals: 0,
    });
    const results = await resolvePendingBets(harness.db, reg);
    expect(results[0]!.status).toBe('cancelled_event');
    const [b] = await harness.db.select().from(bets).where(eq(bets.id, betId));
    expect(b?.status).not.toBe('VOID'); // automation never voids
  });

  it('records error attempts when provider throws', async () => {
    await setupFootballBet({ fixtureId: '105', creatorSide: 'home' });
    const { reg } = REGISTRY_FACTORY();
    // Don't seed the fixture → provider throws NOT_FOUND
    const results = await resolvePendingBets(harness.db, reg);
    expect(results[0]!.status).toBe('error');
    const [attempt] = await harness.db.select().from(autoResolveAttempts);
    expect(attempt?.status).toBe('error');
  });
});

describe('resolvePendingBets — idempotency', () => {
  it('skips bets that already have a proposed result', async () => {
    const { creator, betId } = await setupFootballBet({ fixtureId: '201', creatorSide: 'home' });
    // Manually propose a result first so the bet is no longer eligible.
    await harness.db.execute(
      sql`UPDATE "app"."bets" SET status='AWAITING_RESULT' WHERE id = ${betId}`,
    );
    await proposeResult(harness.db, {
      betId,
      proposedWinnerUserId: creator.id,
      actorType: 'admin',
    });

    const { reg, apiFootball } = REGISTRY_FACTORY();
    apiFootball.setFixture({
      fixtureId: '201',
      statusShort: 'FT',
      homeName: 'A',
      awayName: 'B',
      homeGoals: 1,
      awayGoals: 0,
    });
    const results = await resolvePendingBets(harness.db, reg);
    expect(results).toHaveLength(0);
  });

  it('re-run on the same eligible bet still proposes once, not twice', async () => {
    const { betId } = await setupFootballBet({ fixtureId: '202', creatorSide: 'home' });
    const { reg, apiFootball } = REGISTRY_FACTORY();
    apiFootball.setFixture({
      fixtureId: '202',
      statusShort: 'FT',
      homeName: 'A',
      awayName: 'B',
      homeGoals: 1,
      awayGoals: 0,
    });
    await resolvePendingBets(harness.db, reg);
    const secondRun = await resolvePendingBets(harness.db, reg);
    expect(secondRun).toHaveLength(0);

    const [b] = await harness.db.select().from(bets).where(eq(bets.id, betId));
    expect(b?.proposedWinnerUserId).not.toBeNull();
    // Audit shows exactly one final attempt
    const finals = await harness.db
      .select()
      .from(autoResolveAttempts)
      .where(eq(autoResolveAttempts.status, 'final'));
    expect(finals).toHaveLength(1);
  });
});

describe('resolvePendingBets — CoinGecko predicate routing', () => {
  it('uses CoinGecko for price_above bets', async () => {
    const creator = await createTestUser(harness.db);
    const acceptor = await createTestUser(harness.db);
    await linkTestWallet(harness.db, creator.id);
    await linkTestWallet(harness.db, acceptor.id);
    await fundUser(harness.db, creator.id, '100');
    await fundUser(harness.db, acceptor.id, '100');

    const pastIso = new Date(Date.now() - 60_000).toISOString();
    const { bet } = await createBet(harness.db, {
      creatorUserId: creator.id,
      betType: 'sports_template',
      templateId: 'crypto.price_above',
      title: 'BTC above 50k by now',
      predicate: {
        type: 'price_above',
        asset: 'coingecko:bitcoin',
        threshold: 50_000,
        deadlineAt: pastIso,
      },
      resolveType: 'auto',
      resolveSource: { provider: 'coingecko', externalEventId: 'bitcoin' },
      arbiterType: 'none',
      stakePerSideUsdc: '10',
      creatorSide: 'yes',
      expiresAt: futureIso(86_400_000),
      eventAt: pastIso,
    });
    await acceptBet(harness.db, {
      betId: bet.id,
      acceptorUserId: acceptor.id,
      acceptorSide: 'no',
    });
    await harness.db.execute(
      sql`UPDATE "app"."bets" SET event_at = now() - interval '1 hour' WHERE id = ${bet.id}`,
    );

    const { reg, coingecko } = REGISTRY_FACTORY();
    coingecko.setPrice('bitcoin', 100_000);
    const results = await resolvePendingBets(harness.db, reg);
    expect(results[0]!.status).toBe('proposed');
    expect(results[0]!.provider).toBe('coingecko');
    expect(results[0]!.winnerUserId).toBe(creator.id);
  });
});

describe('closeExpiredDisputeWindows', () => {
  it('closes windows that have elapsed and have no open dispute', async () => {
    const { creator, betId } = await setupFootballBet({ fixtureId: '301', creatorSide: 'home' });
    const { reg, apiFootball } = REGISTRY_FACTORY();
    apiFootball.setFixture({
      fixtureId: '301',
      statusShort: 'FT',
      homeName: 'A',
      awayName: 'B',
      homeGoals: 1,
      awayGoals: 0,
    });
    await resolvePendingBets(harness.db, reg);
    // Force dispute window into the past
    await harness.db.execute(
      sql`UPDATE "app"."bets" SET dispute_window_ends_at = now() - interval '1 hour' WHERE id = ${betId}`,
    );

    const closed = await closeExpiredDisputeWindows(harness.db);
    expect(closed[0]).toEqual({ betId, kind: 'resolved' });
    const [b] = await harness.db.select().from(bets).where(eq(bets.id, betId));
    expect(b?.status).toBe('RESOLVED');
    expect(b?.resolvedWinnerUserId).toBe(creator.id);
  });

  it('does not close when an open dispute is pending', async () => {
    const { acceptor, betId } = await setupFootballBet({ fixtureId: '302', creatorSide: 'home' });
    const { reg, apiFootball } = REGISTRY_FACTORY();
    apiFootball.setFixture({
      fixtureId: '302',
      statusShort: 'FT',
      homeName: 'A',
      awayName: 'B',
      homeGoals: 1,
      awayGoals: 0,
    });
    await resolvePendingBets(harness.db, reg);
    await openDispute(harness.db, {
      betId,
      openerUserId: acceptor.id,
      claimedWinnerUserId: acceptor.id,
      reason: 'disagree',
    });
    // Open dispute moves bet to DISPUTED, so closeExpiredDisputeWindows skips it.
    await harness.db.execute(
      sql`UPDATE "app"."bets" SET dispute_window_ends_at = now() - interval '1 hour' WHERE id = ${betId}`,
    );
    const closed = await closeExpiredDisputeWindows(harness.db);
    expect(closed).toHaveLength(0);
  });
});

describe('runAutoResolveCycle', () => {
  it('combines proposing + closing in a single cycle', async () => {
    const { betId } = await setupFootballBet({ fixtureId: '401', creatorSide: 'home' });
    const { reg, apiFootball } = REGISTRY_FACTORY();
    apiFootball.setFixture({
      fixtureId: '401',
      statusShort: 'FT',
      homeName: 'A',
      awayName: 'B',
      homeGoals: 1,
      awayGoals: 0,
    });

    const first = await runAutoResolveCycle(harness.db, reg);
    expect(first.proposed[0]!.status).toBe('proposed');
    expect(first.closed).toEqual([]);

    // Force window past
    await harness.db.execute(
      sql`UPDATE "app"."bets" SET dispute_window_ends_at = now() - interval '1 hour' WHERE id = ${betId}`,
    );
    const second = await runAutoResolveCycle(harness.db, reg);
    expect(second.proposed).toEqual([]);
    expect(second.closed[0]).toEqual({ betId, kind: 'resolved' });
  });
});
