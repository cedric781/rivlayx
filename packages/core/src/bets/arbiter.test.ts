import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { betArbiters, bets } from '@rivlayx/db';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { arbiterAcceptAssignment, arbiterDeclineAssignment, arbiterRule } from './arbiter';
import { transitionToAwaitingResult } from './resolve';
import { acceptBet } from './accept';
import { createBet } from './create';
import { baseSportsBetInput, fundUser, linkTestWallet } from './test-helpers';

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

async function setupArbiterBet() {
  const creator = await createTestUser(harness.db);
  const acceptor = await createTestUser(harness.db);
  const arbiter = await createTestUser(harness.db);
  await linkTestWallet(harness.db, creator.id);
  await linkTestWallet(harness.db, acceptor.id);
  await fundUser(harness.db, creator.id, '50');
  await fundUser(harness.db, acceptor.id, '50');
  const input = {
    ...baseSportsBetInput(creator.id),
    resolveType: 'arbiter' as const,
    arbiterType: 'user_selected' as const,
    arbiterUserId: arbiter.id,
  };
  const { bet } = await createBet(harness.db, input);
  await acceptBet(harness.db, { betId: bet.id, acceptorUserId: acceptor.id, acceptorSide: 'away' });
  return { creator, acceptor, arbiter, betId: bet.id };
}

describe('arbiterAcceptAssignment', () => {
  it('pending → accepted with decidedAt set', async () => {
    const { arbiter, betId } = await setupArbiterBet();
    await arbiterAcceptAssignment(harness.db, { betId, arbiterUserId: arbiter.id });
    const [row] = await harness.db.select().from(betArbiters).where(eq(betArbiters.betId, betId));
    expect(row?.status).toBe('accepted');
    expect(row?.decidedAt).not.toBeNull();
  });

  it('rejects non-arbiter caller', async () => {
    const { betId } = await setupArbiterBet();
    const stranger = await createTestUser(harness.db);
    await expect(
      arbiterAcceptAssignment(harness.db, { betId, arbiterUserId: stranger.id }),
    ).rejects.toThrow(/NOT_AUTHORIZED/);
  });

  it('rejects when not pending', async () => {
    const { arbiter, betId } = await setupArbiterBet();
    await arbiterAcceptAssignment(harness.db, { betId, arbiterUserId: arbiter.id });
    await expect(
      arbiterAcceptAssignment(harness.db, { betId, arbiterUserId: arbiter.id }),
    ).rejects.toThrow(/WRONG_STATUS/);
  });
});

describe('arbiterDeclineAssignment', () => {
  it('pending → declined', async () => {
    const { arbiter, betId } = await setupArbiterBet();
    await arbiterDeclineAssignment(harness.db, {
      betId,
      arbiterUserId: arbiter.id,
      reason: 'busy',
    });
    const [row] = await harness.db.select().from(betArbiters).where(eq(betArbiters.betId, betId));
    expect(row?.status).toBe('declined');
  });
});

describe('arbiterRule', () => {
  it('records decision and proposes the winner', async () => {
    const { creator, arbiter, betId } = await setupArbiterBet();
    await arbiterAcceptAssignment(harness.db, { betId, arbiterUserId: arbiter.id });
    await transitionToAwaitingResult(harness.db, { betId });
    const result = await arbiterRule(harness.db, {
      betId,
      arbiterUserId: arbiter.id,
      winnerUserId: creator.id,
      decision: { notes: 'creator side fulfilled', evidenceIds: [] },
    });
    expect(result.bet.proposedWinnerUserId).toBe(creator.id);

    const [arbRow] = await harness.db
      .select()
      .from(betArbiters)
      .where(eq(betArbiters.betId, betId));
    expect(arbRow?.decision).toBeDefined();

    const [bet] = await harness.db.select().from(bets).where(eq(bets.id, betId));
    expect(bet?.proposedOutcome).toBeDefined();
  });

  it('rejects when arbiter has not accepted yet', async () => {
    const { creator, arbiter, betId } = await setupArbiterBet();
    await transitionToAwaitingResult(harness.db, { betId });
    await expect(
      arbiterRule(harness.db, {
        betId,
        arbiterUserId: arbiter.id,
        winnerUserId: creator.id,
        decision: {},
      }),
    ).rejects.toThrow(/WRONG_STATUS|must accept first/);
  });

  it('rejects non-arbiter caller', async () => {
    const { creator, arbiter, betId } = await setupArbiterBet();
    await arbiterAcceptAssignment(harness.db, { betId, arbiterUserId: arbiter.id });
    await transitionToAwaitingResult(harness.db, { betId });
    const stranger = await createTestUser(harness.db);
    await expect(
      arbiterRule(harness.db, {
        betId,
        arbiterUserId: stranger.id,
        winnerUserId: creator.id,
        decision: {},
      }),
    ).rejects.toThrow(/NOT_AUTHORIZED/);
  });

  it('rejects on bet not in AWAITING_RESULT', async () => {
    const { creator, arbiter, betId } = await setupArbiterBet();
    await arbiterAcceptAssignment(harness.db, { betId, arbiterUserId: arbiter.id });
    // skip transitionToAwaitingResult — bet is still ACTIVE
    await expect(
      arbiterRule(harness.db, {
        betId,
        arbiterUserId: arbiter.id,
        winnerUserId: creator.id,
        decision: {},
      }),
    ).rejects.toThrow(/WRONG_STATUS|AWAITING_RESULT/);
  });
});
