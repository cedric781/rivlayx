import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { betParticipants, betRules, betShareLinks, betAuditLog, betEvents } from '@rivlayx/db';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { isFrozen, setFreeze } from '../ledger/freeze';
import { getBalance } from '../ledger/balances';
import { BetError } from './errors';
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

const baseInput = (creatorUserId: string) => ({
  creatorUserId,
  betType: 'sports_template' as const,
  templateId: 'football.match_winner',
  title: 'Ajax wins from PSV',
  predicate: {
    type: 'team_wins',
    team: 'Ajax',
    eventReference: 'apifootball:fixture:42',
  },
  resolveType: 'auto' as const,
  resolveSource: {
    provider: 'api_football',
    externalEventId: '42',
  },
  arbiterType: 'none' as const,
  stakePerSideUsdc: '10',
  creatorSide: 'home',
  expiresAt: futureIso(86_400_000),
  eventAt: futureIso(86_400_000 * 2),
});

describe('createBet — happy path', () => {
  it('inserts a bet, rule, share link, creator participant, and locks stake + fee', async () => {
    const user = await createTestUser(harness.db);
    await linkTestWallet(harness.db, user.id);
    await fundUser(harness.db, user.id, '50');

    const result = await createBet(harness.db, baseInput(user.id));
    expect(result.bet.status).toBe('OPEN');
    expect(result.bet.creatorUserId).toBe(user.id);
    expect(result.bet.shortCode).toMatch(/^[A-Za-z0-9]{12}$/);

    // Participant
    const [participant] = await harness.db
      .select()
      .from(betParticipants)
      .where(eq(betParticipants.betId, result.bet.id));
    expect(participant?.role).toBe('creator');
    expect(participant?.side).toBe('home');

    // Rule
    const [rule] = await harness.db
      .select()
      .from(betRules)
      .where(eq(betRules.betId, result.bet.id));
    expect(rule?.ruleIndex).toBe(0);
    expect(rule?.display).toContain('Ajax');

    // Share link
    const [share] = await harness.db
      .select()
      .from(betShareLinks)
      .where(eq(betShareLinks.betId, result.bet.id));
    expect(share?.slug).toBe(result.bet.shortCode);

    // Balance: 50 − 10 stake − 0.5 default creation fee
    const balance = await getBalance(harness.db, user.id);
    expect(balance?.availableUsdc).toBe('39.500000');
    expect(balance?.lockedUsdc).toBe('10.500000');

    // Audit log + events
    const audit = await harness.db
      .select()
      .from(betAuditLog)
      .where(eq(betAuditLog.betId, result.bet.id));
    expect(audit.length).toBeGreaterThanOrEqual(2);
    expect(audit.map((a) => a.toStatus)).toContain('OPEN');

    const events = await harness.db
      .select()
      .from(betEvents)
      .where(eq(betEvents.betId, result.bet.id));
    expect(events.map((e) => e.eventType)).toContain('bet_created');
    expect(events.map((e) => e.eventType)).toContain('bet_opened');
  });
});

describe('createBet — failure scenarios', () => {
  it('rejects when new_bets is frozen', async () => {
    const user = await createTestUser(harness.db);
    await linkTestWallet(harness.db, user.id);
    await fundUser(harness.db, user.id, '50');
    await setFreeze(harness.db, 'new_bets', true, { actorUserId: user.id, reason: 'test' });
    expect(await isFrozen(harness.db, 'new_bets')).toBe(true);

    await expect(createBet(harness.db, baseInput(user.id))).rejects.toThrow(/FROZEN|frozen/);
  });

  it('rejects when balance is insufficient', async () => {
    const user = await createTestUser(harness.db);
    await linkTestWallet(harness.db, user.id);
    await fundUser(harness.db, user.id, '5');

    await expect(createBet(harness.db, baseInput(user.id))).rejects.toThrow(
      /INSUFFICIENT_BALANCE|available/,
    );
  });

  it('rejects stake above MAX_BET_USDC config', async () => {
    const user = await createTestUser(harness.db);
    await linkTestWallet(harness.db, user.id);
    await fundUser(harness.db, user.id, '200');

    await expect(
      createBet(harness.db, { ...baseInput(user.id), stakePerSideUsdc: '100' }),
    ).rejects.toThrow(/STAKE_TOO_LARGE|exceeds/);
  });

  it('rejects subjective phrasing in title', async () => {
    const user = await createTestUser(harness.db);
    await linkTestWallet(harness.db, user.id);
    await fundUser(harness.db, user.id, '50');

    await expect(
      createBet(harness.db, { ...baseInput(user.id), title: 'Wie is beter, Ajax of PSV?' }),
    ).rejects.toThrow(BetError);
  });

  it('rejects malformed predicate', async () => {
    const user = await createTestUser(harness.db);
    await linkTestWallet(harness.db, user.id);
    await fundUser(harness.db, user.id, '50');

    await expect(
      createBet(harness.db, {
        ...baseInput(user.id),
        predicate: { type: 'team_wins' }, // missing fields
      }),
    ).rejects.toThrow(/UNKNOWN_PREDICATE|not a supported/);
  });

  it('rejects unknown template', async () => {
    const user = await createTestUser(harness.db);
    await linkTestWallet(harness.db, user.id);
    await fundUser(harness.db, user.id, '50');

    await expect(
      createBet(harness.db, { ...baseInput(user.id), templateId: 'does.not.exist' }),
    ).rejects.toThrow(/TEMPLATE_NOT_FOUND|not found/);
  });

  it('rejects creator_side not in template sides_schema', async () => {
    const user = await createTestUser(harness.db);
    await linkTestWallet(harness.db, user.id);
    await fundUser(harness.db, user.id, '50');

    await expect(
      createBet(harness.db, { ...baseInput(user.id), creatorSide: 'spaceship' }),
    ).rejects.toThrow(/INVALID_SIDE|not in template/);
  });

  it('rejects when expires_at is in the past', async () => {
    const user = await createTestUser(harness.db);
    await linkTestWallet(harness.db, user.id);
    await fundUser(harness.db, user.id, '50');

    await expect(
      createBet(harness.db, { ...baseInput(user.id), expiresAt: futureIso(-3600_000) }),
    ).rejects.toThrow(/INVALID_EXPIRES_AT/);
  });

  it('rejects when creator has no linked wallet', async () => {
    const user = await createTestUser(harness.db);
    // intentionally skip linkTestWallet
    await fundUser(harness.db, user.id, '50');

    await expect(createBet(harness.db, baseInput(user.id))).rejects.toThrow(
      /wallet|NOT_AUTHORIZED/,
    );
  });

  it('rejects open_objective bet with templateId', async () => {
    const user = await createTestUser(harness.db);
    await linkTestWallet(harness.db, user.id);
    await fundUser(harness.db, user.id, '50');

    await expect(
      createBet(harness.db, {
        ...baseInput(user.id),
        betType: 'open_objective',
        templateId: 'football.match_winner',
      }),
    ).rejects.toThrow(/INVALID_INPUT|must not reference/);
  });

  it('rejects arbiter-resolve bet with arbiter_type=none', async () => {
    const user = await createTestUser(harness.db);
    await linkTestWallet(harness.db, user.id);
    await fundUser(harness.db, user.id, '50');

    await expect(
      createBet(harness.db, {
        ...baseInput(user.id),
        resolveType: 'arbiter',
        arbiterType: 'none',
      }),
    ).rejects.toThrow(/INVALID_ARBITER/);
  });
});
