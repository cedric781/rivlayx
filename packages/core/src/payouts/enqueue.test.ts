import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { bets, payouts } from '@rivlayx/db';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { createBetAwaitingResult, fundUser, linkTestWallet } from '../bets/test-helpers';
import { proposeResult, closeDisputeWindow } from '../bets/resolve';
import { settleBet } from '../bets/settle';
import { enqueueForSettlement, queuePendingForSettledBets } from './enqueue';

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
      'TRUNCATE app.bets CASCADE;',
  );
});

async function fundedUser(withWallet: boolean) {
  const u = await createTestUser(harness.db);
  if (withWallet) await linkTestWallet(harness.db, u.id);
  await fundUser(harness.db, u.id, '100');
  return u;
}

async function settledWinner(creatorId: string, acceptorId: string, winnerId: string) {
  const betId = await createBetAwaitingResult(harness.db, {
    creatorUserId: creatorId,
    acceptorUserId: acceptorId,
  });
  await proposeResult(harness.db, { betId, proposedWinnerUserId: winnerId, actorType: 'admin' });
  await harness.db.execute(
    sql`UPDATE "app"."bets" SET dispute_window_ends_at = now() - interval '1 hour' WHERE id = ${betId}`,
  );
  await closeDisputeWindow(harness.db, { betId });
  const r = await settleBet(harness.db, { betId });
  return { betId, settlementId: r.settlement.id };
}

async function settledDraw(creatorId: string, acceptorId: string) {
  const betId = await createBetAwaitingResult(harness.db, {
    creatorUserId: creatorId,
    acceptorUserId: acceptorId,
  });
  await harness.db.execute(
    sql`UPDATE "app"."bets" SET status='RESOLVED', resolved_winner_user_id=NULL, resolved_at=now() WHERE id = ${betId}`,
  );
  const r = await settleBet(harness.db, { betId });
  return { betId, settlementId: r.settlement.id };
}

describe('queuePendingForSettledBets', () => {
  it('enqueues a payout for a SETTLED winner_payout bet', async () => {
    const creator = await fundedUser(true);
    const acceptor = await fundedUser(true);
    const { betId } = await settledWinner(creator.id, acceptor.id, creator.id);

    const r = await queuePendingForSettledBets(harness.db);
    expect(r).toMatchObject({ swept: 1, queued: 1, deferred: 0 });

    const rows = await harness.db.select().from(payouts).where(eq(payouts.betId, betId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(creator.id);
    expect(rows[0]!.status).toBe('pending');
  });

  it('enqueues two payouts for a draw_refund bet', async () => {
    const creator = await fundedUser(true);
    const acceptor = await fundedUser(true);
    const { betId } = await settledDraw(creator.id, acceptor.id);

    await queuePendingForSettledBets(harness.db);
    const rows = await harness.db.select().from(payouts).where(eq(payouts.betId, betId));
    expect(rows).toHaveLength(2);
  });

  it('is idempotent — a second sweep inserts no duplicate rows', async () => {
    const creator = await fundedUser(true);
    const acceptor = await fundedUser(true);
    const { betId } = await settledWinner(creator.id, acceptor.id, creator.id);

    await queuePendingForSettledBets(harness.db);
    const second = await queuePendingForSettledBets(harness.db);
    expect(second.queued).toBe(1); // re-queued, but...
    const rows = await harness.db.select().from(payouts).where(eq(payouts.betId, betId));
    expect(rows).toHaveLength(1); // ...no duplicate inserted
  });

  it('defers (does not throw) when the winner has no primary wallet at payout time', async () => {
    const creator = await fundedUser(true);
    const acceptor = await fundedUser(true);
    const { settlementId } = await settledWinner(creator.id, acceptor.id, creator.id);
    // Wallet is required to create a bet, but can be removed before payout —
    // the sweep must defer, not throw, so settlement is never blocked.
    await harness.db.execute(
      sql`DELETE FROM "auth"."wallets" WHERE user_id = ${creator.id}`,
    );

    const r = await queuePendingForSettledBets(harness.db);
    expect(r).toMatchObject({ swept: 1, queued: 0, deferred: 1 });

    const single = await enqueueForSettlement(harness.db, settlementId);
    expect(single.status).toBe('deferred_no_wallet');
  });

  it('does not sweep bets already advanced to PAID', async () => {
    const creator = await fundedUser(true);
    const acceptor = await fundedUser(true);
    const { betId } = await settledWinner(creator.id, acceptor.id, creator.id);
    await harness.db.update(bets).set({ status: 'PAID' }).where(eq(bets.id, betId));

    const r = await queuePendingForSettledBets(harness.db);
    expect(r.swept).toBe(0);
    const rows = await harness.db.select().from(payouts).where(eq(payouts.betId, betId));
    expect(rows).toHaveLength(0);
  });
});
