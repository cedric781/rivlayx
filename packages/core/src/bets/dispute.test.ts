import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { bets, disputes, betAuditLog } from '@rivlayx/db';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { getBalance } from '../ledger/balances';
import { proposeResult } from './resolve';
import { openDispute, ruleDispute, withdrawDispute } from './dispute';
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

async function setupProposedBet(stake = '10') {
  const creator = await createTestUser(harness.db);
  const acceptor = await createTestUser(harness.db);
  await linkTestWallet(harness.db, creator.id);
  await linkTestWallet(harness.db, acceptor.id);
  await fundUser(harness.db, creator.id, '500');
  await fundUser(harness.db, acceptor.id, '500');
  const betId = await createBetAwaitingResult(harness.db, {
    creatorUserId: creator.id,
    acceptorUserId: acceptor.id,
    overrides: { stakePerSideUsdc: stake },
  });
  await proposeResult(harness.db, {
    betId,
    proposedWinnerUserId: creator.id,
    actorType: 'admin',
  });
  return { creator, acceptor, betId };
}

describe('openDispute', () => {
  it('locks deposit and moves bet to DISPUTED', async () => {
    const { acceptor, betId } = await setupProposedBet();
    const before = await getBalance(harness.db, acceptor.id);
    const result = await openDispute(harness.db, {
      betId,
      openerUserId: acceptor.id,
      claimedWinnerUserId: acceptor.id,
      reason: 'I disagree with the proposed result',
    });
    expect(result.depositUsdc).toBe('5.000000'); // pot=20, 15%=3, clamped to min 5

    const [b] = await harness.db.select().from(bets).where(eq(bets.id, betId));
    expect(b?.status).toBe('DISPUTED');

    const after = await getBalance(harness.db, acceptor.id);
    expect(after?.lockedUsdc).toBe((Number(before?.lockedUsdc) + 5).toFixed(6));

    const audit = await harness.db.select().from(betAuditLog).where(eq(betAuditLog.betId, betId));
    expect(audit.find((a) => a.toStatus === 'DISPUTED')).toBeDefined();
  });

  it('uses 15% of pot when above min', async () => {
    const { acceptor, betId } = await setupProposedBet('20'); // pot 40, 15% = 6
    const result = await openDispute(harness.db, {
      betId,
      openerUserId: acceptor.id,
      claimedWinnerUserId: acceptor.id,
      reason: 'wrong',
    });
    expect(result.depositUsdc).toBe('6.000000');
  });

  it('rejects when opener is not a participant', async () => {
    const { betId } = await setupProposedBet();
    const stranger = await createTestUser(harness.db);
    await expect(
      openDispute(harness.db, {
        betId,
        openerUserId: stranger.id,
        claimedWinnerUserId: stranger.id,
        reason: 'x',
      }),
    ).rejects.toThrow(/NOT_AUTHORIZED|participant/);
  });

  it('rejects when claimedWinner equals proposed_winner', async () => {
    const { creator, acceptor, betId } = await setupProposedBet();
    await expect(
      openDispute(harness.db, {
        betId,
        openerUserId: acceptor.id,
        claimedWinnerUserId: creator.id, // same as proposed → nothing to dispute
        reason: 'x',
      }),
    ).rejects.toThrow(/INVALID_INPUT|nothing to dispute/);
  });

  it('rejects a second open attempt — once disputed, the bet is no longer in AWAITING_RESULT', async () => {
    const { creator, acceptor, betId } = await setupProposedBet();
    await openDispute(harness.db, {
      betId,
      openerUserId: acceptor.id,
      claimedWinnerUserId: acceptor.id,
      reason: 'first',
    });
    // Bet status now = DISPUTED, so any further open attempt is rejected by
    // the AWAITING_RESULT precondition.
    await expect(
      openDispute(harness.db, {
        betId,
        openerUserId: creator.id,
        claimedWinnerUserId: creator.id,
        reason: 'second',
      }),
    ).rejects.toThrow(/WRONG_STATUS|AWAITING_RESULT/);
  });
});

describe('ruleDispute', () => {
  it('uphold: refunds deposit + claimed winner becomes resolved winner', async () => {
    const { acceptor, betId } = await setupProposedBet();
    const opened = await openDispute(harness.db, {
      betId,
      openerUserId: acceptor.id,
      claimedWinnerUserId: acceptor.id,
      reason: 'disagree',
    });
    const admin = await createTestUser(harness.db);
    const before = await getBalance(harness.db, acceptor.id);

    const ruled = await ruleDispute(harness.db, {
      disputeId: opened.dispute.id,
      adminUserId: admin.id,
      ruling: 'uphold',
      notes: 'evidence agrees with opener',
    });
    expect(ruled.bet.status).toBe('RESOLVED');
    expect(ruled.bet.resolvedWinnerUserId).toBe(acceptor.id);

    // Deposit refunded — opener's locked back to original
    const after = await getBalance(harness.db, acceptor.id);
    expect(Number(after?.availableUsdc)).toBeGreaterThan(Number(before?.availableUsdc));
  });

  it('reject: forfeits deposit + proposed winner stands', async () => {
    const { creator, acceptor, betId } = await setupProposedBet();
    const opened = await openDispute(harness.db, {
      betId,
      openerUserId: acceptor.id,
      claimedWinnerUserId: acceptor.id,
      reason: 'disagree',
    });
    const admin = await createTestUser(harness.db);
    const ruled = await ruleDispute(harness.db, {
      disputeId: opened.dispute.id,
      adminUserId: admin.id,
      ruling: 'reject',
      notes: 'opener is wrong',
    });
    expect(ruled.bet.resolvedWinnerUserId).toBe(creator.id);

    const [d] = await harness.db.select().from(disputes).where(eq(disputes.id, opened.dispute.id));
    expect(d?.status).toBe('rejected');

    // Acceptor lost their deposit
    const acceptorBalance = await getBalance(harness.db, acceptor.id);
    // started 500, locked stake 10, lost deposit 5 → available 485, locked 10
    expect(acceptorBalance?.availableUsdc).toBe('485.000000');
  });

  it('rejects ruling an already-ruled dispute', async () => {
    const { acceptor, betId } = await setupProposedBet();
    const opened = await openDispute(harness.db, {
      betId,
      openerUserId: acceptor.id,
      claimedWinnerUserId: acceptor.id,
      reason: 'x',
    });
    const admin = await createTestUser(harness.db);
    await ruleDispute(harness.db, {
      disputeId: opened.dispute.id,
      adminUserId: admin.id,
      ruling: 'uphold',
    });
    await expect(
      ruleDispute(harness.db, {
        disputeId: opened.dispute.id,
        adminUserId: admin.id,
        ruling: 'reject',
      }),
    ).rejects.toThrow(/WRONG_STATUS/);
  });

  it('rejects winnerUserIdOverride that is not a participant', async () => {
    const { acceptor, betId } = await setupProposedBet();
    const opened = await openDispute(harness.db, {
      betId,
      openerUserId: acceptor.id,
      claimedWinnerUserId: acceptor.id,
      reason: 'x',
    });
    const admin = await createTestUser(harness.db);
    const stranger = await createTestUser(harness.db);
    await expect(
      ruleDispute(harness.db, {
        disputeId: opened.dispute.id,
        adminUserId: admin.id,
        ruling: 'uphold',
        winnerUserIdOverride: stranger.id,
      }),
    ).rejects.toThrow(/INVALID_INPUT|participant/);
  });
});

describe('withdrawDispute', () => {
  it('opener withdraws: deposit refunded, proposed stands, bet RESOLVED', async () => {
    const { creator, acceptor, betId } = await setupProposedBet();
    const opened = await openDispute(harness.db, {
      betId,
      openerUserId: acceptor.id,
      claimedWinnerUserId: acceptor.id,
      reason: 'changed mind',
    });
    const withdrawn = await withdrawDispute(harness.db, {
      disputeId: opened.dispute.id,
      openerUserId: acceptor.id,
      notes: 'wrong call',
    });
    expect(withdrawn.bet.status).toBe('RESOLVED');
    expect(withdrawn.bet.resolvedWinnerUserId).toBe(creator.id);
  });

  it('rejects non-opener withdrawal', async () => {
    const { creator, acceptor, betId } = await setupProposedBet();
    const opened = await openDispute(harness.db, {
      betId,
      openerUserId: acceptor.id,
      claimedWinnerUserId: acceptor.id,
      reason: 'x',
    });
    await expect(
      withdrawDispute(harness.db, {
        disputeId: opened.dispute.id,
        openerUserId: creator.id,
      }),
    ).rejects.toThrow(/NOT_AUTHORIZED|opener/);
  });
});
