import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { bets, ledgerEntries } from '@rivlayx/db';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { createBetAwaitingResult, fundUser, linkTestWallet } from './test-helpers';
import { proposeResult, closeDisputeWindow } from './resolve';
import { setFreeze } from '../ledger/freeze';
import { runSettlementCycle } from './settle-cycle';

let harness: TestDb;

beforeAll(async () => {
  harness = await createTestDb();
});
afterAll(async () => {
  await harness.close();
});
beforeEach(async () => {
  await harness.pg.exec(
    'TRUNCATE auth.users CASCADE; TRUNCATE financial.ledger_entries; TRUNCATE financial.balances; ' +
      'TRUNCATE app.bets CASCADE; ' +
      'TRUNCATE financial.freeze_state CASCADE; ' +
      "INSERT INTO financial.freeze_state (component) VALUES ('new_bets'), ('settlements'), ('withdrawals'), ('all');",
  );
});

async function pair() {
  const creator = await createTestUser(harness.db);
  const acceptor = await createTestUser(harness.db);
  await linkTestWallet(harness.db, creator.id);
  await linkTestWallet(harness.db, acceptor.id);
  await fundUser(harness.db, creator.id, '100');
  await fundUser(harness.db, acceptor.id, '100');
  return { creator, acceptor };
}

/** Build a bet and drive it to RESOLVED (winner = creator), without settling. */
async function resolvedBet(creatorId: string, acceptorId: string): Promise<string> {
  const betId = await createBetAwaitingResult(harness.db, {
    creatorUserId: creatorId,
    acceptorUserId: acceptorId,
  });
  await proposeResult(harness.db, {
    betId,
    proposedWinnerUserId: creatorId,
    actorType: 'admin',
  });
  await harness.db.execute(
    sql`UPDATE "app"."bets" SET dispute_window_ends_at = now() - interval '1 hour' WHERE id = ${betId}`,
  );
  await closeDisputeWindow(harness.db, { betId });
  return betId;
}

describe('runSettlementCycle', () => {
  it('settles every RESOLVED bet and reports their ids', async () => {
    const { creator, acceptor } = await pair();
    const b1 = await resolvedBet(creator.id, acceptor.id);
    const { creator: c2, acceptor: a2 } = await pair();
    const b2 = await resolvedBet(c2.id, a2.id);

    const result = await runSettlementCycle(harness.db);

    expect(result.settled.sort()).toEqual([b1, b2].sort());
    expect(result.errors).toEqual([]);
    for (const id of [b1, b2]) {
      const [bet] = await harness.db.select().from(bets).where(eq(bets.id, id));
      expect(bet!.status).toBe('SETTLED');
    }
  });

  it('ignores non-RESOLVED bets', async () => {
    const { creator, acceptor } = await pair();
    // AWAITING_RESULT (not resolved) — createBetAwaitingResult leaves it there.
    await createBetAwaitingResult(harness.db, {
      creatorUserId: creator.id,
      acceptorUserId: acceptor.id,
    });
    const result = await runSettlementCycle(harness.db);
    expect(result.settled).toEqual([]);
    expect(result.alreadySettled).toEqual([]);
  });

  it('is idempotent — a second run reports nothing newly settled', async () => {
    const { creator, acceptor } = await pair();
    await resolvedBet(creator.id, acceptor.id);
    const first = await runSettlementCycle(harness.db);
    expect(first.settled).toHaveLength(1);

    // Bet is now SETTLED, no longer RESOLVED → not picked up again.
    const second = await runSettlementCycle(harness.db);
    expect(second.settled).toEqual([]);
  });
});

describe('runSettlementCycle — freeze kill-switch', () => {
  async function ledgerCount(): Promise<number> {
    const [r] = await harness.db.select({ n: sql<number>`count(*)::int` }).from(ledgerEntries);
    return Number(r!.n);
  }

  it('settlements freeze hard-skips the cycle — no settle, no ledger writes', async () => {
    const { creator, acceptor } = await pair();
    const betId = await resolvedBet(creator.id, acceptor.id);
    await setFreeze(harness.db, 'settlements', true, { actorUserId: null, reason: 'test' });

    const before = await ledgerCount();
    const result = await runSettlementCycle(harness.db);

    expect(result.skipped).toBe('frozen');
    expect(result.settled).toEqual([]);
    expect(result.alreadySettled).toEqual([]);
    expect(await ledgerCount()).toBe(before); // not one ledger entry posted while frozen
    const [bet] = await harness.db.select().from(bets).where(eq(bets.id, betId));
    expect(bet!.status).toBe('RESOLVED'); // never advanced to SETTLED
  });

  it('global `all` freeze also hard-skips the cycle', async () => {
    const { creator, acceptor } = await pair();
    const betId = await resolvedBet(creator.id, acceptor.id);
    await setFreeze(harness.db, 'all', true, { actorUserId: null, reason: 'test' });

    const before = await ledgerCount();
    const result = await runSettlementCycle(harness.db);

    expect(result.skipped).toBe('frozen');
    expect(result.settled).toEqual([]);
    expect(await ledgerCount()).toBe(before);
    const [bet] = await harness.db.select().from(bets).where(eq(bets.id, betId));
    expect(bet!.status).toBe('RESOLVED');
  });

  it('settles normally once the freeze is lifted — unfrozen behaviour unchanged', async () => {
    const { creator, acceptor } = await pair();
    const betId = await resolvedBet(creator.id, acceptor.id);

    await setFreeze(harness.db, 'settlements', true, { actorUserId: null, reason: 'test' });
    expect((await runSettlementCycle(harness.db)).skipped).toBe('frozen');

    await setFreeze(harness.db, 'settlements', false, { actorUserId: null, reason: 'cleared' });
    const result = await runSettlementCycle(harness.db);
    expect(result.skipped).toBeUndefined();
    expect(result.settled).toEqual([betId]);
    const [bet] = await harness.db.select().from(bets).where(eq(bets.id, betId));
    expect(bet!.status).toBe('SETTLED');
  });
});
