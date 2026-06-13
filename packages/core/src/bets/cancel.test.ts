import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { bets, betAuditLog } from '@rivlayx/db';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { getBalance } from '../ledger/balances';
import { cancelBet } from './cancel';
import { createBet } from './create';
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

async function setupOpenBet() {
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
    expiresAt: futureIso(86_400_000),
  });
  return { creator, bet };
}

describe('cancelBet', () => {
  it('cancels and refunds stake + fee when called by creator on OPEN bet', async () => {
    const { creator, bet } = await setupOpenBet();
    const result = await cancelBet(harness.db, {
      betId: bet.id,
      actorUserId: creator.id,
      reason: 'changed my mind',
    });
    expect(result.bet.status).toBe('CANCELLED');

    const balance = await getBalance(harness.db, creator.id);
    expect(balance?.availableUsdc).toBe('50.000000');
    expect(balance?.lockedUsdc).toBe('0.000000');

    const audit = await harness.db.select().from(betAuditLog).where(eq(betAuditLog.betId, bet.id));
    expect(audit.find((a) => a.toStatus === 'CANCELLED')).toBeDefined();
  });

  it('rejects when called by a non-creator', async () => {
    const { bet } = await setupOpenBet();
    const stranger = await createTestUser(harness.db);
    await expect(
      cancelBet(harness.db, { betId: bet.id, actorUserId: stranger.id }),
    ).rejects.toThrow(/NOT_AUTHORIZED|only the creator/);
  });

  it('rejects when bet is ACTIVE (already accepted)', async () => {
    const { creator, bet } = await setupOpenBet();
    await harness.db.update(bets).set({ status: 'ACTIVE' }).where(eq(bets.id, bet.id));
    await expect(cancelBet(harness.db, { betId: bet.id, actorUserId: creator.id })).rejects.toThrow(
      /WRONG_STATUS/,
    );
  });
});
