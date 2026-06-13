import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { bets, betAuditLog } from '@rivlayx/db';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { getBalance } from '../ledger/balances';
import { createBet } from './create';
import { expireBet } from './expire';
import { fundUser, futureIso, linkTestWallet } from './test-helpers';

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

async function createBetWithExpiry(msInFuture: number) {
  const creator = await createTestUser(harness.db);
  await linkTestWallet(harness.db, creator.id);
  await fundUser(harness.db, creator.id, '50');
  const { bet } = await createBet(harness.db, {
    creatorUserId: creator.id,
    betType: 'sports_template',
    templateId: 'football.match_winner',
    title: 'Ajax wins from PSV',
    predicate: { type: 'team_wins', team: 'Ajax', eventReference: 'apifootball:fixture:42' },
    resolveType: 'auto',
    resolveSource: { provider: 'api_football', externalEventId: '42' },
    arbiterType: 'none',
    stakePerSideUsdc: '10',
    creatorSide: 'home',
    expiresAt: futureIso(msInFuture),
    eventAt: futureIso(msInFuture + 86_400_000),
  });
  return { creator, bet };
}

describe('expireBet', () => {
  it('refunds stake + creation fee when bet OPEN and past expiry', async () => {
    const { creator, bet } = await createBetWithExpiry(86_400_000);
    // Force expiry into the past via direct UPDATE
    await harness.db.execute(
      sql`UPDATE "app"."bets" SET expires_at = now() - interval '1 hour' WHERE id = ${bet.id}`,
    );

    const result = await expireBet(harness.db, { betId: bet.id });
    expect(result.kind).toBe('expired');

    const [updated] = await harness.db.select().from(bets).where(eq(bets.id, bet.id));
    expect(updated?.status).toBe('EXPIRED');
    expect(updated?.expiredAt).not.toBeNull();

    const balance = await getBalance(harness.db, creator.id);
    expect(balance?.availableUsdc).toBe('50.000000');
    expect(balance?.lockedUsdc).toBe('0.000000');

    const audit = await harness.db.select().from(betAuditLog).where(eq(betAuditLog.betId, bet.id));
    expect(audit.find((a) => a.toStatus === 'EXPIRED')).toBeDefined();
  });

  it('is idempotent — re-running on already-EXPIRED bet returns not_expirable', async () => {
    const { bet } = await createBetWithExpiry(86_400_000);
    await harness.db.execute(
      sql`UPDATE "app"."bets" SET expires_at = now() - interval '1 hour' WHERE id = ${bet.id}`,
    );

    await expireBet(harness.db, { betId: bet.id });
    const second = await expireBet(harness.db, { betId: bet.id });
    expect(second.kind).toBe('not_expirable');
  });

  it('returns not_expirable when expiry not yet reached', async () => {
    const { bet } = await createBetWithExpiry(86_400_000);
    const result = await expireBet(harness.db, { betId: bet.id });
    expect(result.kind).toBe('not_expirable');
    expect(result.reason).toContain('expiry');
  });

  it('returns not_expirable when bet is ACTIVE (already accepted)', async () => {
    const { bet } = await createBetWithExpiry(86_400_000);
    await harness.db.update(bets).set({ status: 'ACTIVE' }).where(eq(bets.id, bet.id));
    await harness.db.execute(
      sql`UPDATE "app"."bets" SET expires_at = now() - interval '1 hour' WHERE id = ${bet.id}`,
    );
    const result = await expireBet(harness.db, { betId: bet.id });
    expect(result.kind).toBe('not_expirable');
    expect(result.reason).toContain('ACTIVE');
  });
});
