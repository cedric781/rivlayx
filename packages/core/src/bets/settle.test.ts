import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { betAuditLog, betEvents, ledgerEntries, settlements } from '@rivlayx/db';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { getBalance } from '../ledger/balances';
import { settleBet } from './settle';
import { closeDisputeWindow, proposeResult } from './resolve';
import { createBetAwaitingResult, fundUser, linkTestWallet } from './test-helpers';

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

async function makePair() {
  const creator = await createTestUser(harness.db);
  const acceptor = await createTestUser(harness.db);
  await linkTestWallet(harness.db, creator.id);
  await linkTestWallet(harness.db, acceptor.id);
  await fundUser(harness.db, creator.id, '100');
  await fundUser(harness.db, acceptor.id, '100');
  return { creator, acceptor };
}

/**
 * Walk a bet all the way to RESOLVED with the given winner. We hop
 * AWAITING_RESULT → propose (24h window) → force window into past →
 * closeDisputeWindow → RESOLVED.
 */
async function makeResolvedBet(
  creatorId: string,
  acceptorId: string,
  resolvedWinnerUserId: string,
): Promise<string> {
  const betId = await createBetAwaitingResult(harness.db, {
    creatorUserId: creatorId,
    acceptorUserId: acceptorId,
  });
  await proposeResult(harness.db, {
    betId,
    proposedWinnerUserId: resolvedWinnerUserId,
    actorType: 'admin',
  });
  await harness.db.execute(
    sql`UPDATE "app"."bets"
        SET dispute_window_ends_at = now() - interval '1 hour'
        WHERE id = ${betId}`,
  );
  const r = await closeDisputeWindow(harness.db, { betId });
  expect(r.kind).toBe('resolved');
  return betId;
}

/**
 * Bypass propose-then-resolve to land a bet in RESOLVED with NULL
 * resolved_winner_user_id — emulating an external "draw" decision. This is
 * what the settlement engine treats as kind='draw_refund'.
 */
async function makeDrawResolvedBet(creatorId: string, acceptorId: string): Promise<string> {
  const betId = await createBetAwaitingResult(harness.db, {
    creatorUserId: creatorId,
    acceptorUserId: acceptorId,
  });
  await harness.db.execute(
    sql`UPDATE "app"."bets"
        SET status = 'RESOLVED',
            resolved_winner_user_id = NULL,
            resolved_at = now()
        WHERE id = ${betId}`,
  );
  return betId;
}

describe('settleBet — winner_payout (creator wins)', () => {
  it('credits net to winner, fee to platform, settles bet, audit logs both transitions', async () => {
    const { creator, acceptor } = await makePair();
    const betId = await makeResolvedBet(creator.id, acceptor.id, creator.id);

    // Pre-settle balance snapshot. Stake is 10; creation fee (0.50) was
    // recognized to platform_fee on accept, so creator's available is
    // 100 − 10 (stake) − 0.50 (creation fee) = 89.50.
    const creatorBefore = await getBalance(harness.db, creator.id);
    const acceptorBefore = await getBalance(harness.db, acceptor.id);
    expect(creatorBefore?.lockedUsdc).toBe('10.000000');
    expect(creatorBefore?.availableUsdc).toBe('89.500000');
    expect(acceptorBefore?.lockedUsdc).toBe('10.000000');
    expect(acceptorBefore?.availableUsdc).toBe('90.000000');

    const result = await settleBet(harness.db, { betId });
    expect(result.kind).toBe('settled');
    expect(result.settlement.kind).toBe('winner_payout');
    expect(result.settlement.winnerUserId).toBe(creator.id);
    expect(result.settlement.loserUserId).toBe(acceptor.id);

    // Pot = 20, fee = 20 × 250 / 10000 = 0.5, net = 19.5 (default settlement_fee_bps=250)
    expect(result.settlement.potUsdc).toBe('20.000000');
    expect(result.settlement.platformFeeUsdc).toBe('0.500000');
    expect(result.settlement.netWinnerUsdc).toBe('19.500000');

    // Bet status SETTLED, settled_at populated
    expect(result.bet.status).toBe('SETTLED');
    expect(result.bet.settledAt).toBeInstanceOf(Date);

    // Balances: creator avail 89.50 → 89.50 + 19.5 = 109.00, lock 10→0
    const creatorAfter = await getBalance(harness.db, creator.id);
    expect(creatorAfter?.availableUsdc).toBe('109.000000');
    expect(creatorAfter?.lockedUsdc).toBe('0.000000');
    // Acceptor: avail stays 90, lock 10→0 (stake lost to winner+platform)
    const acceptorAfter = await getBalance(harness.db, acceptor.id);
    expect(acceptorAfter?.availableUsdc).toBe('90.000000');
    expect(acceptorAfter?.lockedUsdc).toBe('0.000000');

    // Audit trail
    const audit = await harness.db.select().from(betAuditLog).where(eq(betAuditLog.betId, betId));
    const settlingRow = audit.find((a) => a.toStatus === 'SETTLING');
    const settledRow = audit.find((a) => a.toStatus === 'SETTLED');
    expect(settlingRow).toBeDefined();
    expect(settledRow).toBeDefined();
    expect(settlingRow!.fromStatus).toBe('RESOLVED');
    expect(settledRow!.fromStatus).toBe('SETTLING');

    // Event feed has bet_settled + bet_win + bet_loss + platform_fee
    const events = await harness.db.select().from(betEvents).where(eq(betEvents.betId, betId));
    const types = events.map((e) => e.eventType);
    expect(types).toContain('bet_settling');
    expect(types).toContain('bet_settled');
    expect(types).toContain('bet_win');
    expect(types).toContain('bet_loss');
    expect(types).toContain('platform_fee');
  });
});

describe('settleBet — winner_payout (acceptor wins)', () => {
  it('credits net to acceptor, fee to platform', async () => {
    const { creator, acceptor } = await makePair();
    const betId = await makeResolvedBet(creator.id, acceptor.id, acceptor.id);

    const result = await settleBet(harness.db, { betId });
    expect(result.settlement.winnerUserId).toBe(acceptor.id);
    expect(result.settlement.loserUserId).toBe(creator.id);

    // Acceptor receives net 19.5: 90 + 19.5 = 109.5
    const acceptorAfter = await getBalance(harness.db, acceptor.id);
    expect(acceptorAfter?.availableUsdc).toBe('109.500000');
    // Creator unlocked, no payout — avail stays at 89.50 (paid 0.50 creation fee)
    const creatorAfter = await getBalance(harness.db, creator.id);
    expect(creatorAfter?.availableUsdc).toBe('89.500000');
    expect(creatorAfter?.lockedUsdc).toBe('0.000000');
  });
});

describe('settleBet — draw_refund', () => {
  it('refunds both participants their stake, takes no fee, no win/loss events', async () => {
    const { creator, acceptor } = await makePair();
    const betId = await makeDrawResolvedBet(creator.id, acceptor.id);

    const result = await settleBet(harness.db, { betId });
    expect(result.settlement.kind).toBe('draw_refund');
    expect(result.settlement.winnerUserId).toBeNull();
    expect(result.settlement.loserUserId).toBeNull();
    expect(result.settlement.platformFeeUsdc).toBe('0.000000');
    expect(result.settlement.netWinnerUsdc).toBe('10.000000'); // stake refunded to each

    // Stakes refunded. Creator: 89.50 + 10 = 99.50 (creation fee stays with
    // platform per blueprint). Acceptor: 90 + 10 = 100.
    const creatorAfter = await getBalance(harness.db, creator.id);
    const acceptorAfter = await getBalance(harness.db, acceptor.id);
    expect(creatorAfter?.availableUsdc).toBe('99.500000');
    expect(acceptorAfter?.availableUsdc).toBe('100.000000');
    expect(creatorAfter?.lockedUsdc).toBe('0.000000');
    expect(acceptorAfter?.lockedUsdc).toBe('0.000000');

    // No winner/loser/fee events
    const events = await harness.db.select().from(betEvents).where(eq(betEvents.betId, betId));
    const types = events.map((e) => e.eventType);
    expect(types).toContain('bet_settled');
    expect(types).not.toContain('bet_win');
    expect(types).not.toContain('bet_loss');
    expect(types).not.toContain('platform_fee');
  });
});

describe('settleBet — VOID is not settled here', () => {
  it('rejects settling a VOID bet (Sprint 7 voidBet handles its own refunds)', async () => {
    const { creator, acceptor } = await makePair();
    const betId = await createBetAwaitingResult(harness.db, {
      creatorUserId: creator.id,
      acceptorUserId: acceptor.id,
    });
    await harness.db.execute(
      sql`UPDATE "app"."bets" SET status = 'VOID', voided_at = now(), void_reason = 'admin call' WHERE id = ${betId}`,
    );
    await expect(settleBet(harness.db, { betId })).rejects.toThrow(/WRONG_STATUS/);
  });
});

describe('settleBet — idempotency', () => {
  it('double settleBet returns kind=already_settled with the same settlement row', async () => {
    const { creator, acceptor } = await makePair();
    const betId = await makeResolvedBet(creator.id, acceptor.id, creator.id);

    const first = await settleBet(harness.db, { betId });
    expect(first.kind).toBe('settled');
    const second = await settleBet(harness.db, { betId });
    expect(second.kind).toBe('already_settled');
    expect(second.settlement.id).toBe(first.settlement.id);

    // Exactly one settlement row
    const all = await harness.db.select().from(settlements).where(eq(settlements.betId, betId));
    expect(all.length).toBe(1);

    // Ledger not duplicated — only the original 4 entries for this txn
    const entries = await harness.db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.txnId, first.settlement.ledgerTxnId));
    expect(entries.length).toBe(4);
  });

  it('balances unchanged on idempotent re-run', async () => {
    const { creator, acceptor } = await makePair();
    const betId = await makeResolvedBet(creator.id, acceptor.id, creator.id);

    await settleBet(harness.db, { betId });
    const after1 = await getBalance(harness.db, creator.id);
    await settleBet(harness.db, { betId });
    const after2 = await getBalance(harness.db, creator.id);
    expect(after1?.availableUsdc).toBe(after2?.availableUsdc);
  });
});

describe('settleBet — preconditions', () => {
  it('rejects non-RESOLVED bets (ACTIVE)', async () => {
    const { creator, acceptor } = await makePair();
    const betId = await createBetAwaitingResult(harness.db, {
      creatorUserId: creator.id,
      acceptorUserId: acceptor.id,
    });
    // bet is AWAITING_RESULT now, not RESOLVED
    await expect(settleBet(harness.db, { betId })).rejects.toThrow(/WRONG_STATUS/);
  });

  it('rejects unknown bet id', async () => {
    await expect(
      settleBet(harness.db, { betId: '00000000-0000-0000-0000-000000000000' }),
    ).rejects.toThrow(/NOT_FOUND/);
  });
});

describe('settleBet — ledger composition', () => {
  it('posts exactly the expected ledger entries for winner_payout', async () => {
    const { creator, acceptor } = await makePair();
    const betId = await makeResolvedBet(creator.id, acceptor.id, creator.id);
    const result = await settleBet(harness.db, { betId });

    const entries = await harness.db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.txnId, result.settlement.ledgerTxnId));
    expect(entries.length).toBe(4);

    const reasons = entries.map((e) => e.reason).sort();
    expect(reasons).toEqual(
      ['settlement_fee', 'settlement_payout', 'settlement_payout', 'settlement_payout'].sort(),
    );

    // Two escrow debits (one per side) + one user_available credit + one platform_fee credit
    const escrowDebits = entries.filter(
      (e) => e.accountType === 'bet_escrow' && e.direction === 'debit',
    );
    expect(escrowDebits.length).toBe(2);
    const userCredits = entries.filter(
      (e) => e.accountType === 'user_available' && e.direction === 'credit',
    );
    expect(userCredits.length).toBe(1);
    expect(userCredits[0]!.accountRef).toBe(creator.id);
    expect(userCredits[0]!.amountUsdc).toBe('19.500000');
    const platformCredits = entries.filter(
      (e) => e.accountType === 'platform_fee' && e.direction === 'credit',
    );
    expect(platformCredits.length).toBe(1);
    expect(platformCredits[0]!.amountUsdc).toBe('0.500000');
  });

  it('posts exactly four refund entries for draw_refund (no platform_fee row)', async () => {
    const { creator, acceptor } = await makePair();
    const betId = await makeDrawResolvedBet(creator.id, acceptor.id);
    const result = await settleBet(harness.db, { betId });

    const entries = await harness.db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.txnId, result.settlement.ledgerTxnId));
    expect(entries.length).toBe(4);
    expect(entries.every((e) => e.reason === 'stake_unlock_refund')).toBe(true);
    const platformCredits = entries.filter((e) => e.accountType === 'platform_fee');
    expect(platformCredits.length).toBe(0);
  });
});

describe('settleBet — bet.status invariants', () => {
  it('bet transitions through SETTLING before SETTLED (audit log has both rows)', async () => {
    const { creator, acceptor } = await makePair();
    const betId = await makeResolvedBet(creator.id, acceptor.id, creator.id);
    await settleBet(harness.db, { betId });

    const audit = await harness.db.select().from(betAuditLog).where(eq(betAuditLog.betId, betId));
    const settling = audit.find((a) => a.fromStatus === 'RESOLVED' && a.toStatus === 'SETTLING');
    const settled = audit.find((a) => a.fromStatus === 'SETTLING' && a.toStatus === 'SETTLED');
    expect(settling).toBeDefined();
    expect(settled).toBeDefined();
  });
});
