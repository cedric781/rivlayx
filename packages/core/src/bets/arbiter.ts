import { and, eq, sql } from 'drizzle-orm';
import { betArbiters, betEvents, type BetStatus } from '@rivlayx/db';
import { BetError } from './errors';
import { proposeResult } from './resolve';
import type {
  ArbiterAcceptInput,
  ArbiterDeclineInput,
  ArbiterRuleInput,
  ArbiterRuleResult,
  BetDb,
} from './types';

/**
 * Arbiter assignment lifecycle:
 *   pending → accepted → (rule)
 *   pending → declined  (admin then re-assigns or voids)
 *
 * `arbiterRule` records the structured decision and delegates to `proposeResult`
 * to drive the bet state machine forward. The arbiter is the actor on the
 * resulting bet_audit_log row.
 */

export async function arbiterAcceptAssignment(db: BetDb, input: ArbiterAcceptInput): Promise<void> {
  await db.transaction(async (tx: BetDb) => {
    const [row] = await tx
      .select()
      .from(betArbiters)
      .where(eq(betArbiters.betId, input.betId))
      .limit(1);
    if (!row) throw new BetError('NOT_FOUND', `no arbiter assigned for bet ${input.betId}`);
    if (row.arbiterUserId !== input.arbiterUserId) {
      throw new BetError('NOT_AUTHORIZED', 'caller is not the assigned arbiter');
    }
    if (row.status !== 'pending') {
      throw new BetError('WRONG_STATUS', `arbiter assignment is ${row.status}, cannot accept`);
    }
    await tx
      .update(betArbiters)
      .set({ status: 'accepted', decidedAt: new Date() })
      .where(eq(betArbiters.betId, input.betId));
    await tx.insert(betEvents).values({
      betId: input.betId,
      eventType: 'bet_disputed',
      actorUserId: input.arbiterUserId,
      payload: { kind: 'arbiter_accepted' },
    });
  });
}

export async function arbiterDeclineAssignment(
  db: BetDb,
  input: ArbiterDeclineInput,
): Promise<void> {
  await db.transaction(async (tx: BetDb) => {
    const [row] = await tx
      .select()
      .from(betArbiters)
      .where(eq(betArbiters.betId, input.betId))
      .limit(1);
    if (!row) throw new BetError('NOT_FOUND', `no arbiter assigned for bet ${input.betId}`);
    if (row.arbiterUserId !== input.arbiterUserId) {
      throw new BetError('NOT_AUTHORIZED', 'caller is not the assigned arbiter');
    }
    if (row.status !== 'pending') {
      throw new BetError('WRONG_STATUS', `arbiter assignment is ${row.status}, cannot decline`);
    }
    await tx
      .update(betArbiters)
      .set({ status: 'declined', decidedAt: new Date() })
      .where(eq(betArbiters.betId, input.betId));
    await tx.insert(betEvents).values({
      betId: input.betId,
      eventType: 'bet_disputed',
      actorUserId: input.arbiterUserId,
      payload: { kind: 'arbiter_declined', reason: input.reason ?? null },
    });
  });
}

/**
 * Record the arbiter's structured decision and propose the winner. The bet
 * must be AWAITING_RESULT (so the resolution window is "open"); the arbiter
 * must have previously accepted.
 */
export async function arbiterRule(db: BetDb, input: ArbiterRuleInput): Promise<ArbiterRuleResult> {
  // First make sure the arbiter is actually authorized + accepted.
  const [arbRow] = await db
    .select()
    .from(betArbiters)
    .where(
      and(eq(betArbiters.betId, input.betId), eq(betArbiters.arbiterUserId, input.arbiterUserId)),
    )
    .limit(1);
  if (!arbRow) throw new BetError('NOT_AUTHORIZED', 'caller is not the assigned arbiter');
  if (arbRow.status !== 'accepted') {
    throw new BetError('WRONG_STATUS', `arbiter must accept first (status=${arbRow.status})`);
  }

  // Check bet status — proposeResult will also validate, but we want to surface
  // a clearer error for the arbiter UI.
  const rows = await db.execute(sql`SELECT status FROM "app"."bets" WHERE id = ${input.betId}`);
  const bRow =
    (rows as { rows?: Array<Record<string, unknown>> }).rows?.[0] ??
    (Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined);
  if (!bRow) throw new BetError('NOT_FOUND', `bet ${input.betId} not found`);
  const status = bRow['status'] as BetStatus;
  if (status !== 'AWAITING_RESULT') {
    throw new BetError(
      'WRONG_STATUS',
      `arbiter can only rule on AWAITING_RESULT bets (got ${status})`,
    );
  }

  // Record decision (separate write — proposeResult opens its own txn).
  await db
    .update(betArbiters)
    .set({ decision: input.decision, decidedAt: new Date() })
    .where(eq(betArbiters.betId, input.betId));

  const proposed = await proposeResult(db, {
    betId: input.betId,
    proposedWinnerUserId: input.winnerUserId,
    proposedOutcome: {
      source: 'arbiter',
      arbiterUserId: input.arbiterUserId,
      decision: input.decision,
    },
    actorUserId: input.arbiterUserId,
    actorType: 'system', // arbiter is recorded on the decision itself; audit shows the system performed the transition
    reason: 'arbiter ruling',
  });

  return {
    bet: proposed.bet,
    proposedAt: proposed.proposedAt,
    disputeWindowEndsAt: proposed.disputeWindowEndsAt,
  };
}
