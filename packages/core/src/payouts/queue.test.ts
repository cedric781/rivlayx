import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { payouts, settlements, wallets } from '@rivlayx/db';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { settleBet } from '../bets/settle';
import { closeDisputeWindow, proposeResult } from '../bets/resolve';
import { createBetAwaitingResult, fundUser, linkTestWallet } from '../bets/test-helpers';
import { PayoutError } from './errors';
import { queuePayoutsForSettlement } from './queue';

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

async function pair() {
  const creator = await createTestUser(harness.db);
  const acceptor = await createTestUser(harness.db);
  await linkTestWallet(harness.db, creator.id);
  await linkTestWallet(harness.db, acceptor.id);
  await fundUser(harness.db, creator.id, '100');
  await fundUser(harness.db, acceptor.id, '100');
  return { creator, acceptor };
}

async function settledWinnerBet(creatorId: string, acceptorId: string, winnerId: string) {
  const betId = await createBetAwaitingResult(harness.db, {
    creatorUserId: creatorId,
    acceptorUserId: acceptorId,
  });
  await proposeResult(harness.db, {
    betId,
    proposedWinnerUserId: winnerId,
    actorType: 'admin',
  });
  await harness.db.execute(
    sql`UPDATE "app"."bets" SET dispute_window_ends_at = now() - interval '1 hour' WHERE id = ${betId}`,
  );
  await closeDisputeWindow(harness.db, { betId });
  const result = await settleBet(harness.db, { betId });
  return result.settlement;
}

async function settledDrawBet(creatorId: string, acceptorId: string) {
  const betId = await createBetAwaitingResult(harness.db, {
    creatorUserId: creatorId,
    acceptorUserId: acceptorId,
  });
  await harness.db.execute(
    sql`UPDATE "app"."bets" SET status='RESOLVED', resolved_winner_user_id=NULL, resolved_at=now() WHERE id = ${betId}`,
  );
  const result = await settleBet(harness.db, { betId });
  return result.settlement;
}

describe('queuePayoutsForSettlement — winner_payout', () => {
  it('queues exactly one payout to the winner with the net amount + primary wallet', async () => {
    const { creator, acceptor } = await pair();
    const settlement = await settledWinnerBet(creator.id, acceptor.id, creator.id);

    const { inserted, existing } = await queuePayoutsForSettlement(harness.db, {
      settlementId: settlement.id,
    });
    expect(inserted.length).toBe(1);
    expect(existing.length).toBe(0);
    expect(inserted[0]!.userId).toBe(creator.id);
    expect(inserted[0]!.amountUsdc).toBe('19.500000');
    expect(inserted[0]!.status).toBe('pending');
    expect(inserted[0]!.destinationWallet).toMatch(/^TestWallet/);
  });

  it('is idempotent on (settlement_id, user_id)', async () => {
    const { creator, acceptor } = await pair();
    const settlement = await settledWinnerBet(creator.id, acceptor.id, creator.id);

    await queuePayoutsForSettlement(harness.db, { settlementId: settlement.id });
    const again = await queuePayoutsForSettlement(harness.db, { settlementId: settlement.id });
    expect(again.inserted.length).toBe(0);
    expect(again.existing.length).toBe(1);

    const rows = await harness.db
      .select()
      .from(payouts)
      .where(eq(payouts.settlementId, settlement.id));
    expect(rows.length).toBe(1);
  });

  it('throws if winner has no primary wallet', async () => {
    const creator = await createTestUser(harness.db);
    const acceptor = await createTestUser(harness.db);
    await linkTestWallet(harness.db, creator.id);
    // acceptor has no wallet
    await fundUser(harness.db, creator.id, '100');
    await fundUser(harness.db, acceptor.id, '100');
    const betId = await createBetAwaitingResult(harness.db, {
      creatorUserId: creator.id,
      acceptorUserId: acceptor.id,
    });
    await proposeResult(harness.db, {
      betId,
      proposedWinnerUserId: acceptor.id,
      actorType: 'admin',
    });
    await harness.db.execute(
      sql`UPDATE "app"."bets" SET dispute_window_ends_at = now() - interval '1 hour' WHERE id = ${betId}`,
    );
    await closeDisputeWindow(harness.db, { betId });
    const settle = await settleBet(harness.db, { betId });

    await expect(
      queuePayoutsForSettlement(harness.db, { settlementId: settle.settlement.id }),
    ).rejects.toThrowError(PayoutError);
  });
});

describe('queuePayoutsForSettlement — draw_refund', () => {
  it('queues two payouts (one per participant) each at stake', async () => {
    const { creator, acceptor } = await pair();
    const settlement = await settledDrawBet(creator.id, acceptor.id);

    const { inserted } = await queuePayoutsForSettlement(harness.db, {
      settlementId: settlement.id,
    });
    expect(inserted.length).toBe(2);
    const ids = inserted.map((p) => p.userId).sort();
    expect(ids).toEqual([creator.id, acceptor.id].sort());
    expect(inserted.every((p) => p.amountUsdc === '10.000000')).toBe(true);
  });
});

describe('queuePayoutsForSettlement — cap enforcement', () => {
  it('rejects oversize amount before insert', async () => {
    const { creator, acceptor } = await pair();
    const settlement = await settledWinnerBet(creator.id, acceptor.id, creator.id);
    // Tamper net_winner to exceed cap
    await harness.db
      .update(settlements)
      .set({ netWinnerUsdc: '999.999999' })
      .where(eq(settlements.id, settlement.id));

    await expect(
      queuePayoutsForSettlement(harness.db, { settlementId: settlement.id }),
    ).rejects.toThrow(/AMOUNT_EXCEEDS_CAP|cap/);

    const rows = await harness.db
      .select()
      .from(payouts)
      .where(eq(payouts.settlementId, settlement.id));
    expect(rows.length).toBe(0);
  });
});

describe('queuePayoutsForSettlement — wallet lookup', () => {
  it('uses the primary wallet, not a secondary one', async () => {
    const { creator, acceptor } = await pair();
    // Add a non-primary wallet to creator — should be ignored
    await harness.db.insert(wallets).values({
      userId: creator.id,
      chain: 'solana',
      address: 'SecondaryWallet_DO_NOT_USE',
      source: 'mock_dev',
      isPrimary: false,
    });
    const settlement = await settledWinnerBet(creator.id, acceptor.id, creator.id);
    const { inserted } = await queuePayoutsForSettlement(harness.db, {
      settlementId: settlement.id,
    });
    expect(inserted[0]!.destinationWallet).not.toBe('SecondaryWallet_DO_NOT_USE');
  });
});
