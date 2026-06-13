import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import {
  bets,
  betAuditLog,
  betEvents,
  freezeState,
  ledgerEntries,
  payouts,
  payoutAttempts,
} from '@rivlayx/db';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { getBalance } from '../ledger/balances';
import { settleBet } from '../bets/settle';
import { closeDisputeWindow, proposeResult } from '../bets/resolve';
import { createBetAwaitingResult, fundUser, linkTestWallet } from '../bets/test-helpers';
import { MockSolanaTransferProvider } from './transfer-mock';
import { queuePayoutsForSettlement } from './queue';
import { processPayoutQueue, processOnePayout } from './runner';
import { PAYOUT_LIMITS } from './cap';

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

async function settledWinner(creatorId: string, acceptorId: string, winnerId: string) {
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

describe('processPayoutQueue — happy path (winner_payout)', () => {
  it('succeeds: ledger debits user_available, credits deposit_holding, bet → PAID', async () => {
    const { creator, acceptor } = await pair();
    const { betId, settlementId } = await settledWinner(creator.id, acceptor.id, creator.id);

    await queuePayoutsForSettlement(harness.db, { settlementId });

    const provider = new MockSolanaTransferProvider();
    const result = await processPayoutQueue(harness.db, provider);

    expect(result.candidatesSeen).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.skippedFrozen).toBe(false);

    // Payout row updated
    const [p] = await harness.db.select().from(payouts).where(eq(payouts.betId, betId));
    expect(p!.status).toBe('succeeded');
    expect(p!.txSignature).toMatch(/^mocksig_/);
    expect(p!.attempts).toBe(1);
    expect(p!.succeededAt).toBeInstanceOf(Date);

    // Ledger: payout debits the winner's user_available and credits the vault
    // asset (deposit_holding) — NOT treasury. Winner available 109.00 → 89.50.
    const creatorBalance = await getBalance(harness.db, creator.id);
    expect(creatorBalance?.availableUsdc).toBe('89.500000');

    const ledgerLegs = await harness.db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.txnId, p!.ledgerTxnId!));
    const byAccount = Object.fromEntries(ledgerLegs.map((e) => [e.accountType, e]));
    expect(byAccount['treasury']).toBeUndefined();
    expect(byAccount['user_available']?.direction).toBe('debit');
    expect(byAccount['deposit_holding']?.direction).toBe('credit');
    expect(byAccount['deposit_holding']?.accountRef).toBe('vault');
    // M1: on-chain signature recorded on the immutable ledger leg, not just the row.
    expect(byAccount['deposit_holding']?.relatedTxSignature).toBe(p!.txSignature);

    // Bet advanced to PAID
    const [bet] = await harness.db.select().from(bets).where(eq(bets.id, betId));
    expect(bet!.status).toBe('PAID');
    expect(bet!.paidAt).toBeInstanceOf(Date);

    // Audit + event log
    const audit = await harness.db.select().from(betAuditLog).where(eq(betAuditLog.betId, betId));
    expect(audit.find((a) => a.toStatus === 'PAID')).toBeDefined();

    const events = await harness.db.select().from(betEvents).where(eq(betEvents.betId, betId));
    expect(events.map((e) => e.eventType)).toContain('bet_paid');

    // Attempt recorded
    const [attempt] = await harness.db
      .select()
      .from(payoutAttempts)
      .where(eq(payoutAttempts.payoutId, p!.id));
    expect(attempt!.status).toBe('succeeded');
    expect(attempt!.attemptNumber).toBe(1);
  });
});

describe('processPayoutQueue — happy path (draw_refund)', () => {
  it('succeeds for both payouts; bet → PAID only after both complete', async () => {
    const { creator, acceptor } = await pair();
    const { betId, settlementId } = await settledDraw(creator.id, acceptor.id);
    await queuePayoutsForSettlement(harness.db, { settlementId });

    const provider = new MockSolanaTransferProvider();
    const result = await processPayoutQueue(harness.db, provider);
    expect(result.succeeded).toBe(2);

    const rows = await harness.db.select().from(payouts).where(eq(payouts.betId, betId));
    expect(rows.length).toBe(2);
    expect(rows.every((p) => p.status === 'succeeded')).toBe(true);

    const [bet] = await harness.db.select().from(bets).where(eq(bets.id, betId));
    expect(bet!.status).toBe('PAID');
  });

  it('does NOT advance to PAID while one payout is still pending', async () => {
    const { creator, acceptor } = await pair();
    const { betId, settlementId } = await settledDraw(creator.id, acceptor.id);
    await queuePayoutsForSettlement(harness.db, { settlementId });

    const provider = new MockSolanaTransferProvider();
    // Process only one payout via direct invocation
    const rows = await harness.db.select().from(payouts).where(eq(payouts.betId, betId));
    const first = rows[0]!;
    await processOnePayout(harness.db, provider, first.id);

    const [bet] = await harness.db.select().from(bets).where(eq(bets.id, betId));
    expect(bet!.status).toBe('SETTLED'); // not yet PAID
  });
});

describe('processPayoutQueue — retry on retryable error', () => {
  it('schedules a backoff and keeps status=pending; succeeds on the next pass', async () => {
    const { creator, acceptor } = await pair();
    const { settlementId } = await settledWinner(creator.id, acceptor.id, creator.id);
    const { inserted } = await queuePayoutsForSettlement(harness.db, { settlementId });
    const payoutId = inserted[0]!.id;

    const provider = new MockSolanaTransferProvider();
    provider.setRetryableFailure(payoutId, 2, 'rpc timeout');

    // Run 1 — first retryable failure
    const r1 = await processPayoutQueue(harness.db, provider);
    expect(r1.failedRetryable).toBe(1);
    const [after1] = await harness.db.select().from(payouts).where(eq(payouts.id, payoutId));
    expect(after1!.status).toBe('pending');
    expect(after1!.attempts).toBe(1);
    expect(after1!.lastError).toMatch(/rpc timeout/);
    expect(after1!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    // The runner won't re-pick it because next_attempt_at is in the future.
    // Force the clock forward by rewriting next_attempt_at.
    await harness.db
      .update(payouts)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(payouts.id, payoutId));

    // Run 2 — second retryable failure
    await processPayoutQueue(harness.db, provider);
    const [after2] = await harness.db.select().from(payouts).where(eq(payouts.id, payoutId));
    expect(after2!.attempts).toBe(2);
    expect(after2!.status).toBe('pending');

    await harness.db
      .update(payouts)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(payouts.id, payoutId));

    // Run 3 — now the mock has exhausted its programmed failures, succeeds
    const r3 = await processPayoutQueue(harness.db, provider);
    expect(r3.succeeded).toBe(1);
    const [after3] = await harness.db.select().from(payouts).where(eq(payouts.id, payoutId));
    expect(after3!.status).toBe('succeeded');

    const attempts = await harness.db
      .select()
      .from(payoutAttempts)
      .where(eq(payoutAttempts.payoutId, payoutId));
    expect(attempts.length).toBe(3);
    expect(attempts.map((a) => a.status).sort()).toEqual(
      ['failed_retryable', 'failed_retryable', 'succeeded'].sort(),
    );
  });
});

describe('processPayoutQueue — exhausts retries → failed', () => {
  it('marks failed after maxAttempts retryable errors', async () => {
    const { creator, acceptor } = await pair();
    const { settlementId } = await settledWinner(creator.id, acceptor.id, creator.id);
    const { inserted } = await queuePayoutsForSettlement(harness.db, { settlementId });
    const payoutId = inserted[0]!.id;

    // Lower maxAttempts to 2 to keep the test tight.
    await harness.db.update(payouts).set({ maxAttempts: 2 }).where(eq(payouts.id, payoutId));

    const provider = new MockSolanaTransferProvider();
    provider.setRetryableFailure(payoutId, 99, 'rpc broken');

    await processPayoutQueue(harness.db, provider);
    await harness.db
      .update(payouts)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(payouts.id, payoutId));
    await processPayoutQueue(harness.db, provider);

    const [p] = await harness.db.select().from(payouts).where(eq(payouts.id, payoutId));
    expect(p!.status).toBe('failed');
    expect(p!.lastError).toMatch(/retries exhausted/);
    expect(p!.failedAt).toBeInstanceOf(Date);
    expect(p!.attempts).toBe(2);
  });
});

describe('processPayoutQueue — permanent failure', () => {
  it('marks failed immediately with the error message; no ledger movement', async () => {
    const { creator, acceptor } = await pair();
    const { settlementId } = await settledWinner(creator.id, acceptor.id, creator.id);
    const { inserted } = await queuePayoutsForSettlement(harness.db, { settlementId });
    const payoutId = inserted[0]!.id;

    const provider = new MockSolanaTransferProvider();
    provider.setPermanentFailure(payoutId, 'invalid destination wallet');

    const r = await processPayoutQueue(harness.db, provider);
    expect(r.failedPermanent).toBe(1);

    const [p] = await harness.db.select().from(payouts).where(eq(payouts.id, payoutId));
    expect(p!.status).toBe('failed');
    expect(p!.lastError).toMatch(/invalid destination/);

    // Ledger has NO withdrawal_complete entries for this bet
    const entries = await harness.db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.betId, p!.betId));
    expect(entries.filter((e) => e.reason === 'withdrawal_complete').length).toBe(0);

    // Bet stays SETTLED, NOT PAID
    const [bet] = await harness.db.select().from(bets).where(eq(bets.id, p!.betId));
    expect(bet!.status).toBe('SETTLED');
  });
});

describe('processPayoutQueue — freeze gating', () => {
  it('skips entirely when withdrawals freeze is active', async () => {
    const { creator, acceptor } = await pair();
    const { settlementId } = await settledWinner(creator.id, acceptor.id, creator.id);
    await queuePayoutsForSettlement(harness.db, { settlementId });

    await harness.db
      .update(freezeState)
      .set({ frozen: true })
      .where(eq(freezeState.component, 'withdrawals'));

    const provider = new MockSolanaTransferProvider();
    const r = await processPayoutQueue(harness.db, provider);
    expect(r.skippedFrozen).toBe(true);
    expect(r.candidatesSeen).toBe(0);

    const [p] = await harness.db.select().from(payouts);
    expect(p!.status).toBe('pending');
  });

  it('skips when global "all" freeze is active', async () => {
    const { creator, acceptor } = await pair();
    const { settlementId } = await settledWinner(creator.id, acceptor.id, creator.id);
    await queuePayoutsForSettlement(harness.db, { settlementId });

    await harness.db
      .update(freezeState)
      .set({ frozen: true })
      .where(eq(freezeState.component, 'all'));

    const provider = new MockSolanaTransferProvider();
    const r = await processPayoutQueue(harness.db, provider);
    expect(r.skippedFrozen).toBe(true);
  });
});

describe('processOnePayout — idempotency', () => {
  it('second run on a succeeded payout is a no-op', async () => {
    const { creator, acceptor } = await pair();
    const { settlementId } = await settledWinner(creator.id, acceptor.id, creator.id);
    const { inserted } = await queuePayoutsForSettlement(harness.db, { settlementId });
    const payoutId = inserted[0]!.id;

    const provider = new MockSolanaTransferProvider();
    const first = await processOnePayout(harness.db, provider, payoutId);
    expect(first.kind).toBe('succeeded');

    const second = await processOnePayout(harness.db, provider, payoutId);
    expect(second.kind).toBe('skipped');

    // Only one ledger txn for withdrawal_complete on this bet
    const [p] = await harness.db.select().from(payouts).where(eq(payouts.id, payoutId));
    const entries = await harness.db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.txnId, p!.ledgerTxnId!));
    expect(entries.length).toBe(2);

    // Only one attempt logged
    const attempts = await harness.db
      .select()
      .from(payoutAttempts)
      .where(eq(payoutAttempts.payoutId, payoutId));
    expect(attempts.length).toBe(1);
  });
});

describe('processOnePayout — cap defence', () => {
  it('flips to failed immediately when amount is tampered above the cap', async () => {
    const { creator, acceptor } = await pair();
    const { settlementId } = await settledWinner(creator.id, acceptor.id, creator.id);
    const { inserted } = await queuePayoutsForSettlement(harness.db, { settlementId });
    const payoutId = inserted[0]!.id;

    await harness.db
      .update(payouts)
      .set({ amountUsdc: '999.999999' })
      .where(eq(payouts.id, payoutId));

    const provider = new MockSolanaTransferProvider();
    const r = await processOnePayout(harness.db, provider, payoutId);
    expect(r.kind).toBe('permanent_failure');
    const [p] = await harness.db.select().from(payouts).where(eq(payouts.id, payoutId));
    expect(p!.status).toBe('failed');
    expect(p!.lastError).toMatch(/cap|EXCEEDS/);
  });
});

describe('PAYOUT_LIMITS', () => {
  it('exposes the locked safety cap', () => {
    expect(PAYOUT_LIMITS.maxPayoutUsdc).toBe('50');
    expect(PAYOUT_LIMITS.maxAttempts).toBe(5);
  });
});
