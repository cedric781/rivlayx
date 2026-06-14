import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { bets, betParticipants, betAuditLog, betEvents } from '@rivlayx/db';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { getBalance } from '../ledger/balances';
import { setFreeze } from '../ledger/freeze';
import { acceptBet } from './accept';
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

async function setupOpenBet(
  opts: {
    creatorBalance?: string;
    stake?: string;
    creatorSide?: string;
  } = {},
) {
  const creator = await createTestUser(harness.db);
  await linkTestWallet(harness.db, creator.id);
  await fundUser(harness.db, creator.id, opts.creatorBalance ?? '50');
  const { bet } = await createBet(harness.db, {
    creatorUserId: creator.id,
    betType: 'sports_template',
    templateId: 'football.match_winner',
    title: 'Ajax wins from PSV',
    predicate: {
      type: 'team_wins',
      team: 'Ajax',
      eventReference: 'apifootball:fixture:42',
    },
    resolveType: 'auto',
    resolveSource: { provider: 'api_football', externalEventId: '42' },
    arbiterType: 'none',
    stakePerSideUsdc: opts.stake ?? '10',
    creatorSide: opts.creatorSide ?? 'home',
    expiresAt: futureIso(86_400_000),
    eventAt: futureIso(86_400_000 * 2),
  });
  return { creator, bet };
}

describe('acceptBet — happy path', () => {
  it('locks acceptor stake, recognises creator fee, status OPEN → ACTIVE', async () => {
    const { creator, bet } = await setupOpenBet();
    const acceptor = await createTestUser(harness.db);
    await linkTestWallet(harness.db, acceptor.id);
    await fundUser(harness.db, acceptor.id, '50');

    const result = await acceptBet(harness.db, {
      betId: bet.id,
      acceptorUserId: acceptor.id,
      acceptorSide: 'away',
    });
    expect(result.bet.status).toBe('ACTIVE');
    expect(result.bet.acceptorUserId).toBe(acceptor.id);

    // creator: lost the 0.5 creation fee to platform (locked → recognised)
    const creatorBalance = await getBalance(harness.db, creator.id);
    expect(creatorBalance?.availableUsdc).toBe('39.500000');
    expect(creatorBalance?.lockedUsdc).toBe('10.000000');

    // acceptor: 10 locked in escrow
    const accBalance = await getBalance(harness.db, acceptor.id);
    expect(accBalance?.availableUsdc).toBe('40.000000');
    expect(accBalance?.lockedUsdc).toBe('10.000000');

    const participants = await harness.db
      .select()
      .from(betParticipants)
      .where(eq(betParticipants.betId, bet.id));
    expect(participants.map((p) => p.role).sort()).toEqual(['acceptor', 'creator']);
  });

  it('writes the OPEN → ACTIVE audit log + accepted/activated events', async () => {
    const { bet } = await setupOpenBet();
    const acceptor = await createTestUser(harness.db);
    await linkTestWallet(harness.db, acceptor.id);
    await fundUser(harness.db, acceptor.id, '50');

    await acceptBet(harness.db, {
      betId: bet.id,
      acceptorUserId: acceptor.id,
      acceptorSide: 'away',
    });

    const auditRows = await harness.db
      .select()
      .from(betAuditLog)
      .where(eq(betAuditLog.betId, bet.id));
    const activeAudit = auditRows.filter(
      (r) => r.fromStatus === 'OPEN' && r.toStatus === 'ACTIVE',
    );
    expect(activeAudit.length).toBeGreaterThanOrEqual(1);

    const eventRows = await harness.db.select().from(betEvents).where(eq(betEvents.betId, bet.id));
    const eventTypes = eventRows.map((e) => e.eventType);
    expect(eventTypes).toContain('bet_accepted');
    expect(eventTypes).toContain('bet_activated');
  });
});

describe('acceptBet — failure scenarios', () => {
  it('rejects when creator tries to accept own bet', async () => {
    const { creator, bet } = await setupOpenBet();
    await fundUser(harness.db, creator.id, '20');
    await expect(
      acceptBet(harness.db, {
        betId: bet.id,
        acceptorUserId: creator.id,
        acceptorSide: 'away',
      }),
    ).rejects.toThrow(/SAME_USER|own bet/);
  });

  it('rejects when acceptor side equals creator side', async () => {
    const { bet } = await setupOpenBet({ creatorSide: 'home' });
    const acceptor = await createTestUser(harness.db);
    await linkTestWallet(harness.db, acceptor.id);
    await fundUser(harness.db, acceptor.id, '50');
    await expect(
      acceptBet(harness.db, { betId: bet.id, acceptorUserId: acceptor.id, acceptorSide: 'home' }),
    ).rejects.toThrow(/INVALID_SIDE|differ/);
  });

  it('rejects when acceptor side not in template sides', async () => {
    const { bet } = await setupOpenBet();
    const acceptor = await createTestUser(harness.db);
    await linkTestWallet(harness.db, acceptor.id);
    await fundUser(harness.db, acceptor.id, '50');
    await expect(
      acceptBet(harness.db, {
        betId: bet.id,
        acceptorUserId: acceptor.id,
        acceptorSide: 'spaceship',
      }),
    ).rejects.toThrow(/INVALID_SIDE|not in template/);
  });

  it('rejects when acceptor has insufficient balance', async () => {
    const { bet } = await setupOpenBet({ stake: '20' });
    const acceptor = await createTestUser(harness.db);
    await linkTestWallet(harness.db, acceptor.id);
    await fundUser(harness.db, acceptor.id, '5');
    await expect(
      acceptBet(harness.db, { betId: bet.id, acceptorUserId: acceptor.id, acceptorSide: 'away' }),
    ).rejects.toThrow(/INSUFFICIENT_BALANCE/);
  });

  it('rejects when new_bets frozen', async () => {
    const { creator, bet } = await setupOpenBet();
    const acceptor = await createTestUser(harness.db);
    await linkTestWallet(harness.db, acceptor.id);
    await fundUser(harness.db, acceptor.id, '50');
    await setFreeze(harness.db, 'new_bets', true, { actorUserId: creator.id, reason: 't' });
    await expect(
      acceptBet(harness.db, { betId: bet.id, acceptorUserId: acceptor.id, acceptorSide: 'away' }),
    ).rejects.toThrow(/FROZEN|frozen/);
  });

  it('rejects when bet is not OPEN', async () => {
    const { bet } = await setupOpenBet();
    // Force status to ACTIVE manually
    await harness.db.update(bets).set({ status: 'ACTIVE' }).where(eq(bets.id, bet.id));
    const acceptor = await createTestUser(harness.db);
    await linkTestWallet(harness.db, acceptor.id);
    await fundUser(harness.db, acceptor.id, '50');
    await expect(
      acceptBet(harness.db, { betId: bet.id, acceptorUserId: acceptor.id, acceptorSide: 'away' }),
    ).rejects.toThrow(/WRONG_STATUS|not OPEN/);
  });

  it('rejects when the open window has expired', async () => {
    const { bet } = await setupOpenBet();
    // Force the open window into the past.
    await harness.db
      .update(bets)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(bets.id, bet.id));
    const acceptor = await createTestUser(harness.db);
    await linkTestWallet(harness.db, acceptor.id);
    await fundUser(harness.db, acceptor.id, '50');
    await expect(
      acceptBet(harness.db, { betId: bet.id, acceptorUserId: acceptor.id, acceptorSide: 'away' }),
    ).rejects.toThrow(/EXPIRED_WINDOW|expired/);
  });

  it('rejects a second accept once the bet is already taken', async () => {
    const { bet } = await setupOpenBet();
    const first = await createTestUser(harness.db);
    await linkTestWallet(harness.db, first.id);
    await fundUser(harness.db, first.id, '50');
    await acceptBet(harness.db, { betId: bet.id, acceptorUserId: first.id, acceptorSide: 'away' });

    const second = await createTestUser(harness.db);
    await linkTestWallet(harness.db, second.id);
    await fundUser(harness.db, second.id, '50');
    await expect(
      acceptBet(harness.db, { betId: bet.id, acceptorUserId: second.id, acceptorSide: 'away' }),
    ).rejects.toThrow(/WRONG_STATUS|ALREADY_ACCEPTED|not OPEN/);
  });

  it('rejects when bet not found', async () => {
    const acceptor = await createTestUser(harness.db);
    await linkTestWallet(harness.db, acceptor.id);
    await fundUser(harness.db, acceptor.id, '50');
    await expect(
      acceptBet(harness.db, {
        betId: '00000000-0000-0000-0000-000000000000',
        acceptorUserId: acceptor.id,
        acceptorSide: 'away',
      }),
    ).rejects.toThrow(/NOT_FOUND/);
  });
});
