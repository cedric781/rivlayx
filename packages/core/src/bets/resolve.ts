import Decimal from 'decimal.js';
import { and, eq, sql } from 'drizzle-orm';
import { bets, disputes, type BetStatus } from '@rivlayx/db';
import { BetError } from './errors';
import { recordBetTransition } from './audit';
import { refundCreationFee, refundStakeToParticipant } from './escrow';
import { refundDisputeDeposit } from './dispute-escrow';
import { DISPUTE_WINDOW_MS } from './dispute-config';
import type {
  BetDb,
  ProposeResultInput,
  ProposeResultResult,
  TransitionToAwaitingInput,
  TransitionToAwaitingResult,
  CloseDisputeWindowInput,
  CloseDisputeWindowResult,
  VoidBetInput,
  VoidBetResult,
} from './types';

/**
 * Move an ACTIVE bet to AWAITING_RESULT — the event is over and resolution
 * can begin. Triggered by cron (system actor) when `event_at` is past, or by
 * admin force-advance.
 *
 *   - Idempotent: re-running on AWAITING_RESULT returns `kind: 'noop'`.
 *   - Only ACTIVE bets are transitionable here.
 */
export async function transitionToAwaitingResult(
  db: BetDb,
  input: TransitionToAwaitingInput,
): Promise<TransitionToAwaitingResult> {
  return db.transaction(async (tx: BetDb) => {
    const row = await selectBetForUpdate(tx, input.betId);
    if (!row) throw new BetError('NOT_FOUND', `bet ${input.betId} not found`);
    const status = row['status'] as BetStatus;
    if (status === 'AWAITING_RESULT') return { kind: 'noop', reason: 'already awaiting' };
    if (status !== 'ACTIVE') {
      throw new BetError('WRONG_STATUS', `cannot transition from ${status}`);
    }

    const updated = await tx
      .update(bets)
      .set({
        status: 'AWAITING_RESULT',
        version: sql`${bets.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(bets.id, input.betId), eq(bets.status, 'ACTIVE')))
      .returning();
    if (updated.length === 0) return { kind: 'noop', reason: 'concurrent state change' };

    await recordBetTransition(tx, {
      betId: input.betId,
      fromStatus: 'ACTIVE',
      toStatus: 'AWAITING_RESULT',
      eventType: 'bet_disputed', // generic event type closest to in-flight resolution
      actorUserId: input.actorUserId ?? null,
      actorType: input.actorUserId ? 'admin' : 'system',
      reason: input.reason ?? 'event window reached; awaiting result',
    });

    return { kind: 'transitioned', bet: updated[0]! };
  });
}

/**
 * Propose a result on an AWAITING_RESULT bet. Sets `proposed_winner_user_id`,
 * `proposed_outcome`, `proposed_at`, `dispute_window_ends_at = now + 24h`.
 *
 * Triggered by:
 *   - admin (admin actor)
 *   - arbiter ruling (system actor, called from arbiter.ts)
 *   - auto-resolve provider (Sprint 8+)
 */
export async function proposeResult(
  db: BetDb,
  input: ProposeResultInput,
): Promise<ProposeResultResult> {
  return db.transaction(async (tx: BetDb) => {
    const row = await selectBetForUpdate(tx, input.betId);
    if (!row) throw new BetError('NOT_FOUND', `bet ${input.betId} not found`);
    const status = row['status'] as BetStatus;
    if (status !== 'AWAITING_RESULT') {
      throw new BetError('WRONG_STATUS', `proposeResult requires AWAITING_RESULT, got ${status}`);
    }
    if (row['proposed_winner_user_id']) {
      throw new BetError('WRONG_STATUS', 'result already proposed on this bet');
    }
    if (
      input.proposedWinnerUserId !== row['creator_user_id'] &&
      input.proposedWinnerUserId !== row['acceptor_user_id']
    ) {
      throw new BetError(
        'INVALID_INPUT',
        'proposedWinnerUserId must be the creator or acceptor of this bet',
      );
    }

    const proposedAt = new Date();
    const disputeWindowEndsAt = new Date(proposedAt.getTime() + DISPUTE_WINDOW_MS);

    const updated = await tx
      .update(bets)
      .set({
        proposedWinnerUserId: input.proposedWinnerUserId,
        proposedOutcome: input.proposedOutcome ?? null,
        proposedAt,
        disputeWindowEndsAt,
        version: sql`${bets.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(bets.id, input.betId), eq(bets.status, 'AWAITING_RESULT')))
      .returning();
    if (updated.length === 0) {
      throw new BetError('WRONG_STATUS', 'bet status moved before update committed');
    }

    await recordBetTransition(tx, {
      betId: input.betId,
      fromStatus: 'AWAITING_RESULT',
      toStatus: 'AWAITING_RESULT',
      eventType: 'bet_resolved',
      actorUserId: input.actorUserId ?? null,
      actorType: input.actorType,
      reason: input.reason ?? 'result proposed',
      metadata: { proposedWinnerUserId: input.proposedWinnerUserId },
    });

    return { bet: updated[0]!, proposedAt, disputeWindowEndsAt };
  });
}

/**
 * Close the dispute window for an AWAITING_RESULT bet with a proposed result
 * and no open dispute. Promotes the proposed winner to resolved winner and
 * moves status to RESOLVED.
 *
 *   - Idempotent: returns `kind: 'noop'` for non-AWAITING_RESULT bets.
 *   - Does NOT trigger payout — payout is Sprint 10.
 */
export async function closeDisputeWindow(
  db: BetDb,
  input: CloseDisputeWindowInput,
): Promise<CloseDisputeWindowResult> {
  return db.transaction(async (tx: BetDb) => {
    const row = await selectBetForUpdate(tx, input.betId);
    if (!row) throw new BetError('NOT_FOUND', `bet ${input.betId} not found`);
    const status = row['status'] as BetStatus;
    if (status !== 'AWAITING_RESULT') {
      return { kind: 'noop', reason: `status is ${status}` };
    }
    const proposedWinner = row['proposed_winner_user_id'];
    if (!proposedWinner) {
      return { kind: 'noop', reason: 'no proposed result yet' };
    }
    const windowEnd = row['dispute_window_ends_at']
      ? new Date(row['dispute_window_ends_at'] as string)
      : null;
    if (!windowEnd || windowEnd.getTime() > Date.now()) {
      return { kind: 'noop', reason: 'dispute window still open' };
    }
    // Belt-and-braces: confirm no open dispute (state machine should already prevent it)
    const open = await tx
      .select({ id: disputes.id })
      .from(disputes)
      .where(and(eq(disputes.betId, input.betId), eq(disputes.status, 'open')))
      .limit(1);
    if (open.length > 0) {
      return { kind: 'noop', reason: 'open dispute pending' };
    }

    const now = new Date();
    const updated = await tx
      .update(bets)
      .set({
        status: 'RESOLVED',
        resolvedWinnerUserId: proposedWinner as string,
        resolvedAt: now,
        version: sql`${bets.version} + 1`,
        updatedAt: now,
      })
      .where(and(eq(bets.id, input.betId), eq(bets.status, 'AWAITING_RESULT')))
      .returning();
    if (updated.length === 0) return { kind: 'noop', reason: 'concurrent state change' };

    await recordBetTransition(tx, {
      betId: input.betId,
      fromStatus: 'AWAITING_RESULT',
      toStatus: 'RESOLVED',
      eventType: 'bet_resolved',
      actorUserId: null,
      actorType: 'system',
      reason: 'dispute window elapsed; proposed result stands',
      metadata: { resolvedWinnerUserId: proposedWinner as string },
    });

    return { kind: 'resolved', bet: updated[0]! };
  });
}

/**
 * Admin void of any in-flight bet. Refunds both stakes + creator's creation
 * fee + any open dispute deposit. Audit log records actor + reason.
 *
 * Valid source states: ACTIVE, AWAITING_RESULT, DISPUTED (+ OPEN for admin
 * intervention — refunds only creator's stake + fee since no acceptor yet).
 */
export async function voidBet(db: BetDb, input: VoidBetInput): Promise<VoidBetResult> {
  return db.transaction(async (tx: BetDb) => {
    const row = await selectBetForUpdate(tx, input.betId);
    if (!row) throw new BetError('NOT_FOUND', `bet ${input.betId} not found`);
    const status = row['status'] as BetStatus;
    const validSources: BetStatus[] = ['OPEN', 'ACTIVE', 'AWAITING_RESULT', 'DISPUTED'];
    if (!validSources.includes(status)) {
      throw new BetError('WRONG_STATUS', `cannot void from status ${status}`);
    }

    const stake = new Decimal(row['stake_per_side_usdc'] as string);
    const creationFee = new Decimal(row['creation_fee_usdc'] as string);
    const creatorUserId = row['creator_user_id'] as string;
    const acceptorUserId = row['acceptor_user_id'] as string | null;

    const updated = await tx
      .update(bets)
      .set({
        status: 'VOID',
        voidedAt: new Date(),
        voidReason: input.reason,
        version: sql`${bets.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(bets.id, input.betId), eq(bets.status, status)))
      .returning();
    if (updated.length === 0) {
      throw new BetError('WRONG_STATUS', 'bet status moved before update committed');
    }

    // Refund creator stake.
    await refundStakeToParticipant(tx, {
      betId: input.betId,
      userId: creatorUserId,
      amountUsdc: stake.toFixed(6),
    });

    // Refund acceptor stake when present.
    if (acceptorUserId) {
      await refundStakeToParticipant(tx, {
        betId: input.betId,
        userId: acceptorUserId,
        amountUsdc: stake.toFixed(6),
      });
    }

    // Refund creation fee: from creation_fee_hold if still held (OPEN/no acceptor),
    // OR no-op if already recognised to platform (post-acceptance void leaves it kept,
    // per blueprint "platform fee blijft" on void). For Sprint 7: refund only when
    // bet was voided pre-acceptance (no acceptor).
    if (!acceptorUserId && creationFee.gt(0)) {
      await refundCreationFee(tx, {
        betId: input.betId,
        creatorUserId,
        amountUsdc: creationFee.toFixed(6),
      });
    }

    // Refund any open dispute deposit.
    const openDispute = await tx
      .select()
      .from(disputes)
      .where(and(eq(disputes.betId, input.betId), eq(disputes.status, 'open')))
      .limit(1);
    if (openDispute[0]) {
      const d = openDispute[0];
      await refundDisputeDeposit(tx, {
        betId: input.betId,
        openerUserId: d.openerUserId,
        amountUsdc: d.depositUsdc,
      });
      await tx
        .update(disputes)
        .set({
          status: 'withdrawn',
          ruledAt: new Date(),
          ruledByUserId: input.actorUserId,
          rulingNotes: input.reason,
        })
        .where(eq(disputes.id, d.id));
    }

    await recordBetTransition(tx, {
      betId: input.betId,
      fromStatus: status,
      toStatus: 'VOID',
      eventType: 'bet_voided',
      actorUserId: input.actorUserId,
      actorType: 'admin',
      reason: input.reason,
    });

    return { bet: updated[0]! };
  });
}

/**
 * Internal helper — `SELECT ... FOR UPDATE` on a bet, returning a snake-cased
 * record. Centralised so all resolve functions guard against concurrent
 * state changes consistently.
 */
async function selectBetForUpdate(
  tx: BetDb,
  betId: string,
): Promise<Record<string, unknown> | null> {
  const rows = await tx.execute(
    sql`SELECT id, creator_user_id, acceptor_user_id, status, version,
               stake_per_side_usdc, creation_fee_usdc,
               proposed_winner_user_id, proposed_at, dispute_window_ends_at,
               resolved_winner_user_id, resolve_type
        FROM "app"."bets"
        WHERE id = ${betId}
        FOR UPDATE`,
  );
  const row =
    (rows as { rows?: Array<Record<string, unknown>> }).rows?.[0] ??
    (Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined);
  return row ?? null;
}
