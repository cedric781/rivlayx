import Decimal from 'decimal.js';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { bets, disputes, type BetStatus, type NewDispute } from '@rivlayx/db';
import { BetError } from './errors';
import { recordBetTransition } from './audit';
import { DISPUTE_DEFAULTS, computeDisputeDeposit, type DisputeConfig } from './dispute-config';
import { forfeitDisputeDeposit, lockDisputeDeposit, refundDisputeDeposit } from './dispute-escrow';
import { enqueueReputationRefresh } from '../reputation/queue';
import type {
  BetDb,
  OpenDisputeInput,
  OpenDisputeResult,
  RuleDisputeInput,
  RuleDisputeResult,
  WithdrawDisputeInput,
  WithdrawDisputeResult,
} from './types';

/**
 * Open a dispute on an AWAITING_RESULT bet whose proposed result is being
 * contested. The opener pays a deposit (15% of pot, clamped). On ruling:
 *   - upheld   → deposit refunded, claimed_winner becomes resolved_winner
 *   - rejected → deposit forfeit, proposed result stands
 *   - withdrawn → deposit refunded, proposed result stands (RESOLVED)
 */
export async function openDispute(
  db: BetDb,
  input: OpenDisputeInput,
  config: DisputeConfig = DISPUTE_DEFAULTS,
): Promise<OpenDisputeResult> {
  if (input.reason.trim().length === 0 || input.reason.length > 2000) {
    throw new BetError('INVALID_INPUT', 'reason must be 1..2000 characters');
  }

  return db.transaction(async (tx: BetDb) => {
    const rows = await tx.execute(
      sql`SELECT id, creator_user_id, acceptor_user_id, status,
                 stake_per_side_usdc, proposed_winner_user_id,
                 dispute_window_ends_at
          FROM "app"."bets"
          WHERE id = ${input.betId}
          FOR UPDATE`,
    );
    const row =
      (rows as { rows?: Array<Record<string, unknown>> }).rows?.[0] ??
      (Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined);
    if (!row) throw new BetError('NOT_FOUND', `bet ${input.betId} not found`);

    const status = row['status'] as BetStatus;
    if (status !== 'AWAITING_RESULT') {
      throw new BetError('WRONG_STATUS', `dispute requires AWAITING_RESULT, got ${status}`);
    }
    if (!row['proposed_winner_user_id']) {
      throw new BetError('WRONG_STATUS', 'no proposed result to dispute');
    }
    const windowEnd = row['dispute_window_ends_at']
      ? new Date(row['dispute_window_ends_at'] as string)
      : null;
    if (!windowEnd || windowEnd.getTime() <= Date.now()) {
      throw new BetError('EXPIRED_WINDOW', 'dispute window has closed');
    }

    const creatorUserId = row['creator_user_id'] as string;
    const acceptorUserId = row['acceptor_user_id'] as string | null;
    if (input.openerUserId !== creatorUserId && input.openerUserId !== acceptorUserId) {
      throw new BetError('NOT_AUTHORIZED', 'opener must be a participant of the bet');
    }
    if (
      input.claimedWinnerUserId !== creatorUserId &&
      input.claimedWinnerUserId !== acceptorUserId
    ) {
      throw new BetError(
        'INVALID_INPUT',
        'claimedWinnerUserId must be the creator or acceptor of this bet',
      );
    }
    if (input.claimedWinnerUserId === row['proposed_winner_user_id']) {
      throw new BetError(
        'INVALID_INPUT',
        'claimedWinnerUserId equals proposed_winner — nothing to dispute',
      );
    }

    // No open dispute already.
    const open = await tx
      .select({ id: disputes.id })
      .from(disputes)
      .where(and(eq(disputes.betId, input.betId), eq(disputes.status, 'open')))
      .limit(1);
    if (open.length > 0) {
      throw new BetError('ALREADY_ACCEPTED', 'another dispute is already open for this bet');
    }

    const stake = new Decimal(row['stake_per_side_usdc'] as string);
    const pot = stake.mul(2).toFixed(6);
    const depositUsdc = computeDisputeDeposit(pot, config);

    const newDispute: NewDispute = {
      id: randomUUID(),
      betId: input.betId,
      openerUserId: input.openerUserId,
      claimedWinnerUserId: input.claimedWinnerUserId,
      reason: input.reason,
      depositUsdc,
      status: 'open',
    };
    const [insertedDispute] = await tx.insert(disputes).values(newDispute).returning();
    if (!insertedDispute) throw new BetError('INVALID_INPUT', 'failed to insert dispute');

    await lockDisputeDeposit(tx, {
      betId: input.betId,
      openerUserId: input.openerUserId,
      amountUsdc: depositUsdc,
    });

    const updated = await tx
      .update(bets)
      .set({
        status: 'DISPUTED',
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
      toStatus: 'DISPUTED',
      eventType: 'bet_disputed',
      actorUserId: input.openerUserId,
      actorType: 'user',
      reason: 'dispute opened',
      metadata: {
        disputeId: insertedDispute.id,
        depositUsdc,
        claimedWinnerUserId: input.claimedWinnerUserId,
      },
    });

    return { dispute: insertedDispute, bet: updated[0]!, depositUsdc };
  });
}

/**
 * Admin rules on an open dispute.
 *
 *   - uphold: claimedWinnerUserId (or override) becomes resolved_winner;
 *             dispute deposit refunded.
 *   - reject: proposed_winner stands; dispute deposit forfeited to platform_fee.
 *
 * Either way the bet moves DISPUTED → RESOLVED.
 *
 * `adminUserId` is the actor; this function does NOT enforce the role
 * itself — the API layer is responsible for that.
 */
export async function ruleDispute(db: BetDb, input: RuleDisputeInput): Promise<RuleDisputeResult> {
  return db.transaction(async (tx: BetDb) => {
    const [dispute] = await tx
      .select()
      .from(disputes)
      .where(eq(disputes.id, input.disputeId))
      .limit(1);
    if (!dispute) throw new BetError('NOT_FOUND', `dispute ${input.disputeId} not found`);
    if (dispute.status !== 'open') {
      throw new BetError('WRONG_STATUS', `dispute is ${dispute.status}, cannot rule`);
    }

    const rows = await tx.execute(
      sql`SELECT id, creator_user_id, acceptor_user_id, status, proposed_winner_user_id
          FROM "app"."bets"
          WHERE id = ${dispute.betId}
          FOR UPDATE`,
    );
    const row =
      (rows as { rows?: Array<Record<string, unknown>> }).rows?.[0] ??
      (Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined);
    if (!row) throw new BetError('NOT_FOUND', `bet ${dispute.betId} not found`);
    if ((row['status'] as BetStatus) !== 'DISPUTED') {
      throw new BetError(
        'WRONG_STATUS',
        `bet status is ${String(row['status'])}, expected DISPUTED`,
      );
    }

    let resolvedWinnerUserId: string;
    if (input.ruling === 'uphold') {
      const candidate = input.winnerUserIdOverride ?? dispute.claimedWinnerUserId;
      if (candidate !== row['creator_user_id'] && candidate !== row['acceptor_user_id']) {
        throw new BetError('INVALID_INPUT', 'winnerUserIdOverride must be a participant');
      }
      resolvedWinnerUserId = candidate;
      await refundDisputeDeposit(tx, {
        betId: dispute.betId,
        openerUserId: dispute.openerUserId,
        amountUsdc: dispute.depositUsdc,
      });
    } else {
      resolvedWinnerUserId = row['proposed_winner_user_id'] as string;
      await forfeitDisputeDeposit(tx, {
        betId: dispute.betId,
        openerUserId: dispute.openerUserId,
        amountUsdc: dispute.depositUsdc,
      });
    }

    const now = new Date();
    const [updatedDispute] = await tx
      .update(disputes)
      .set({
        status: input.ruling === 'uphold' ? 'upheld' : 'rejected',
        ruledAt: now,
        ruledByUserId: input.adminUserId,
        rulingNotes: input.notes ?? null,
      })
      .where(eq(disputes.id, input.disputeId))
      .returning();

    const updatedBet = await tx
      .update(bets)
      .set({
        status: 'RESOLVED',
        resolvedWinnerUserId,
        resolvedAt: now,
        version: sql`${bets.version} + 1`,
        updatedAt: now,
      })
      .where(and(eq(bets.id, dispute.betId), eq(bets.status, 'DISPUTED')))
      .returning();
    if (updatedBet.length === 0) {
      throw new BetError('WRONG_STATUS', 'bet status moved before update committed');
    }

    await recordBetTransition(tx, {
      betId: dispute.betId,
      fromStatus: 'DISPUTED',
      toStatus: 'RESOLVED',
      eventType: 'bet_resolved',
      actorUserId: input.adminUserId,
      actorType: 'admin',
      reason:
        input.ruling === 'uphold'
          ? 'dispute upheld — claimed winner becomes resolved winner'
          : 'dispute rejected — proposed result stands',
      metadata: {
        disputeId: dispute.id,
        ruling: input.ruling,
        resolvedWinnerUserId,
      },
    });

    // Transactional outbox: refresh both participants' reputation out-of-band.
    await enqueueReputationRefresh(tx, row['creator_user_id'] as string, 'dispute_ruling');
    if (row['acceptor_user_id']) {
      await enqueueReputationRefresh(tx, row['acceptor_user_id'] as string, 'dispute_ruling');
    }

    return { dispute: updatedDispute!, bet: updatedBet[0]! };
  });
}

/**
 * Opener withdraws their own dispute before a ruling. Deposit is refunded.
 * The proposed result stands: bet moves DISPUTED → RESOLVED with
 * proposed_winner as resolved_winner.
 */
export async function withdrawDispute(
  db: BetDb,
  input: WithdrawDisputeInput,
): Promise<WithdrawDisputeResult> {
  return db.transaction(async (tx: BetDb) => {
    const [dispute] = await tx
      .select()
      .from(disputes)
      .where(eq(disputes.id, input.disputeId))
      .limit(1);
    if (!dispute) throw new BetError('NOT_FOUND', `dispute ${input.disputeId} not found`);
    if (dispute.status !== 'open') {
      throw new BetError('WRONG_STATUS', `dispute is ${dispute.status}, cannot withdraw`);
    }
    if (dispute.openerUserId !== input.openerUserId) {
      throw new BetError('NOT_AUTHORIZED', 'only the opener may withdraw a dispute');
    }

    const rows = await tx.execute(
      sql`SELECT id, status, proposed_winner_user_id
          FROM "app"."bets"
          WHERE id = ${dispute.betId}
          FOR UPDATE`,
    );
    const row =
      (rows as { rows?: Array<Record<string, unknown>> }).rows?.[0] ??
      (Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined);
    if (!row) throw new BetError('NOT_FOUND', `bet ${dispute.betId} not found`);
    if ((row['status'] as BetStatus) !== 'DISPUTED') {
      throw new BetError(
        'WRONG_STATUS',
        `bet status is ${String(row['status'])}, expected DISPUTED`,
      );
    }

    await refundDisputeDeposit(tx, {
      betId: dispute.betId,
      openerUserId: dispute.openerUserId,
      amountUsdc: dispute.depositUsdc,
    });

    const now = new Date();
    const [updatedDispute] = await tx
      .update(disputes)
      .set({
        status: 'withdrawn',
        ruledAt: now,
        ruledByUserId: input.openerUserId,
        rulingNotes: input.notes ?? null,
      })
      .where(eq(disputes.id, input.disputeId))
      .returning();

    const proposedWinner = row['proposed_winner_user_id'] as string;
    const updatedBet = await tx
      .update(bets)
      .set({
        status: 'RESOLVED',
        resolvedWinnerUserId: proposedWinner,
        resolvedAt: now,
        version: sql`${bets.version} + 1`,
        updatedAt: now,
      })
      .where(and(eq(bets.id, dispute.betId), eq(bets.status, 'DISPUTED')))
      .returning();
    if (updatedBet.length === 0) {
      throw new BetError('WRONG_STATUS', 'bet status moved before update committed');
    }

    await recordBetTransition(tx, {
      betId: dispute.betId,
      fromStatus: 'DISPUTED',
      toStatus: 'RESOLVED',
      eventType: 'bet_resolved',
      actorUserId: input.openerUserId,
      actorType: 'user',
      reason: 'dispute withdrawn; proposed result stands',
      metadata: { disputeId: dispute.id, resolvedWinnerUserId: proposedWinner },
    });

    return { dispute: updatedDispute!, bet: updatedBet[0]! };
  });
}
