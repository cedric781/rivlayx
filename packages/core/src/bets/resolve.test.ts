import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { bets, betAuditLog, disputes } from '@rivlayx/db';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { getBalance } from '../ledger/balances';
import { closeDisputeWindow, proposeResult, transitionToAwaitingResult, voidBet } from './resolve';
import { openDispute } from './dispute';
import { createBet } from './create';
import {
  baseSportsBetInput,
  createActiveBet,
  createBetAwaitingResult,
  fundUser,
  linkTestWallet,
} from './test-helpers';

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

describe('transitionToAwaitingResult', () => {
  it('ACTIVE → AWAITING_RESULT, audit recorded', async () => {
    const { creator, acceptor } = await makePair();
    const betId = await createActiveBet(harness.db, {
      creatorUserId: creator.id,
      acceptorUserId: acceptor.id,
    });
    const result = await transitionToAwaitingResult(harness.db, { betId });
    expect(result.kind).toBe('transitioned');
    const [b] = await harness.db.select().from(bets).where(eq(bets.id, betId));
    expect(b?.status).toBe('AWAITING_RESULT');

    const audit = await harness.db.select().from(betAuditLog).where(eq(betAuditLog.betId, betId));
    expect(audit.find((a) => a.toStatus === 'AWAITING_RESULT')).toBeDefined();
  });

  it('is idempotent: already AWAITING_RESULT → noop', async () => {
    const { creator, acceptor } = await makePair();
    const betId = await createBetAwaitingResult(harness.db, {
      creatorUserId: creator.id,
      acceptorUserId: acceptor.id,
    });
    const result = await transitionToAwaitingResult(harness.db, { betId });
    expect(result.kind).toBe('noop');
  });

  it('rejects on bets that are not ACTIVE', async () => {
    const creator = await createTestUser(harness.db);
    await linkTestWallet(harness.db, creator.id);
    await fundUser(harness.db, creator.id, '50');
    const { bet } = await createBet(harness.db, baseSportsBetInput(creator.id));
    await expect(transitionToAwaitingResult(harness.db, { betId: bet.id })).rejects.toThrow(
      /WRONG_STATUS|cannot transition/,
    );
  });
});

describe('proposeResult', () => {
  it('sets proposed_winner + 24h window + audit', async () => {
    const { creator, acceptor } = await makePair();
    const betId = await createBetAwaitingResult(harness.db, {
      creatorUserId: creator.id,
      acceptorUserId: acceptor.id,
    });
    const before = Date.now();
    const result = await proposeResult(harness.db, {
      betId,
      proposedWinnerUserId: creator.id,
      proposedOutcome: { source: 'admin', score: '2-1' },
      actorUserId: acceptor.id, // admin actor for test purposes
      actorType: 'admin',
    });
    expect(result.bet.proposedWinnerUserId).toBe(creator.id);
    expect(result.disputeWindowEndsAt.getTime() - before).toBeGreaterThanOrEqual(86_400_000 - 1000);
  });

  it('rejects if not AWAITING_RESULT', async () => {
    const { creator, acceptor } = await makePair();
    const betId = await createActiveBet(harness.db, {
      creatorUserId: creator.id,
      acceptorUserId: acceptor.id,
    });
    await expect(
      proposeResult(harness.db, {
        betId,
        proposedWinnerUserId: creator.id,
        actorType: 'admin',
      }),
    ).rejects.toThrow(/WRONG_STATUS/);
  });

  it('rejects when proposed_winner is not a participant', async () => {
    const { creator, acceptor } = await makePair();
    const stranger = await createTestUser(harness.db);
    const betId = await createBetAwaitingResult(harness.db, {
      creatorUserId: creator.id,
      acceptorUserId: acceptor.id,
    });
    await expect(
      proposeResult(harness.db, {
        betId,
        proposedWinnerUserId: stranger.id,
        actorType: 'admin',
      }),
    ).rejects.toThrow(/INVALID_INPUT|creator or acceptor/);
  });

  it('rejects double-propose', async () => {
    const { creator, acceptor } = await makePair();
    const betId = await createBetAwaitingResult(harness.db, {
      creatorUserId: creator.id,
      acceptorUserId: acceptor.id,
    });
    await proposeResult(harness.db, {
      betId,
      proposedWinnerUserId: creator.id,
      actorType: 'admin',
    });
    await expect(
      proposeResult(harness.db, {
        betId,
        proposedWinnerUserId: acceptor.id,
        actorType: 'admin',
      }),
    ).rejects.toThrow(/already proposed|WRONG_STATUS/);
  });
});

describe('closeDisputeWindow', () => {
  it('promotes to RESOLVED with proposed winner once window passes', async () => {
    const { creator, acceptor } = await makePair();
    const betId = await createBetAwaitingResult(harness.db, {
      creatorUserId: creator.id,
      acceptorUserId: acceptor.id,
    });
    await proposeResult(harness.db, {
      betId,
      proposedWinnerUserId: creator.id,
      actorType: 'admin',
    });
    // Force window into the past
    await harness.db.execute(
      sql`UPDATE "app"."bets" SET dispute_window_ends_at = now() - interval '1 hour' WHERE id = ${betId}`,
    );
    const result = await closeDisputeWindow(harness.db, { betId });
    expect(result.kind).toBe('resolved');

    const [b] = await harness.db.select().from(bets).where(eq(bets.id, betId));
    expect(b?.status).toBe('RESOLVED');
    expect(b?.resolvedWinnerUserId).toBe(creator.id);
  });

  it('noop when window still open', async () => {
    const { creator, acceptor } = await makePair();
    const betId = await createBetAwaitingResult(harness.db, {
      creatorUserId: creator.id,
      acceptorUserId: acceptor.id,
    });
    await proposeResult(harness.db, {
      betId,
      proposedWinnerUserId: creator.id,
      actorType: 'admin',
    });
    const result = await closeDisputeWindow(harness.db, { betId });
    expect(result.kind).toBe('noop');
  });

  it('noop when no proposed result', async () => {
    const { creator, acceptor } = await makePair();
    const betId = await createBetAwaitingResult(harness.db, {
      creatorUserId: creator.id,
      acceptorUserId: acceptor.id,
    });
    const result = await closeDisputeWindow(harness.db, { betId });
    expect(result.kind).toBe('noop');
  });

  it('noop when an open dispute is pending', async () => {
    const { creator, acceptor } = await makePair();
    const betId = await createBetAwaitingResult(harness.db, {
      creatorUserId: creator.id,
      acceptorUserId: acceptor.id,
    });
    await proposeResult(harness.db, {
      betId,
      proposedWinnerUserId: creator.id,
      actorType: 'admin',
    });
    await openDispute(harness.db, {
      betId,
      openerUserId: acceptor.id,
      claimedWinnerUserId: acceptor.id,
      reason: 'I disagree',
    });
    // Force window to past
    await harness.db.execute(
      sql`UPDATE "app"."bets" SET dispute_window_ends_at = now() - interval '1 hour' WHERE id = ${betId}`,
    );
    // Bet status is now DISPUTED, not AWAITING_RESULT — close should noop
    const result = await closeDisputeWindow(harness.db, { betId });
    expect(result.kind).toBe('noop');
  });
});

describe('voidBet', () => {
  it('refunds both stakes from ACTIVE bet', async () => {
    const { creator, acceptor } = await makePair();
    const betId = await createActiveBet(harness.db, {
      creatorUserId: creator.id,
      acceptorUserId: acceptor.id,
    });
    const admin = await createTestUser(harness.db);
    await voidBet(harness.db, {
      betId,
      actorUserId: admin.id,
      reason: 'event cancelled',
    });

    const [b] = await harness.db.select().from(bets).where(eq(bets.id, betId));
    expect(b?.status).toBe('VOID');
    expect(b?.voidReason).toBe('event cancelled');

    const creatorBalance = await getBalance(harness.db, creator.id);
    const acceptorBalance = await getBalance(harness.db, acceptor.id);
    // creator originally 100, paid 10 stake + 0.5 fee (already recognised on accept) → after void refund stake only → 99.5
    expect(creatorBalance?.availableUsdc).toBe('99.500000');
    expect(acceptorBalance?.availableUsdc).toBe('100.000000');
  });

  it('refunds open dispute deposit when voiding a DISPUTED bet', async () => {
    const { creator, acceptor } = await makePair();
    const betId = await createBetAwaitingResult(harness.db, {
      creatorUserId: creator.id,
      acceptorUserId: acceptor.id,
    });
    await proposeResult(harness.db, {
      betId,
      proposedWinnerUserId: creator.id,
      actorType: 'admin',
    });
    await openDispute(harness.db, {
      betId,
      openerUserId: acceptor.id,
      claimedWinnerUserId: acceptor.id,
      reason: 'I disagree',
    });
    const admin = await createTestUser(harness.db);
    await voidBet(harness.db, {
      betId,
      actorUserId: admin.id,
      reason: 'manual void',
    });

    const acceptorBalance = await getBalance(harness.db, acceptor.id);
    // acceptor: 100 − 10 stake (refunded) − dispute deposit (refunded) = 100
    expect(acceptorBalance?.availableUsdc).toBe('100.000000');
    const [d] = await harness.db.select().from(disputes).where(eq(disputes.betId, betId));
    expect(d?.status).toBe('withdrawn');
  });

  it('rejects voiding RESOLVED or PAID bets', async () => {
    const { creator, acceptor } = await makePair();
    const betId = await createBetAwaitingResult(harness.db, {
      creatorUserId: creator.id,
      acceptorUserId: acceptor.id,
    });
    await harness.db.update(bets).set({ status: 'RESOLVED' }).where(eq(bets.id, betId));
    const admin = await createTestUser(harness.db);
    await expect(
      voidBet(harness.db, { betId, actorUserId: admin.id, reason: 'too late' }),
    ).rejects.toThrow(/WRONG_STATUS/);
  });
});
