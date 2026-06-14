import { and, eq, or, sql } from 'drizzle-orm';
import { bets, disputes, settlements, users } from '@rivlayx/db';
import { REPUTATION_DEFAULTS, type ReputationConfig } from './config';
import type { ReputationSignals } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ReputationDb = any;

function firstRow(res: unknown): Record<string, unknown> | undefined {
  return (
    (res as { rows?: Array<Record<string, unknown>> }).rows?.[0] ??
    (Array.isArray(res) ? (res[0] as Record<string, unknown> | undefined) : undefined)
  );
}

const MS_PER_DAY = 86_400_000;

/**
 * Gather all reputation signals for one user from the live tables. The
 * fraud-resistant shape (distinct counterparties, per-counterparty-capped
 * volume, admin-ruled dispute classification) lives here; scoring is pure
 * downstream in `computeReputation`.
 */
export async function gatherReputationSignals(
  db: ReputationDb,
  userId: string,
  config: ReputationConfig = REPUTATION_DEFAULTS,
): Promise<ReputationSignals> {
  const [user] = await db
    .select({ status: users.status, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    return {
      distinctCounterparties: 0,
      completedBets: 0,
      matchedBets: 0,
      cappedSettledVolumeUsdc: '0',
      ageDays: 0,
      wins: 0,
      losses: 0,
      frivolousDisputes: 0,
      adverseDisputes: 0,
      status: 'deleted',
    };
  }

  const ageDays = Math.max(0, Math.floor((Date.now() - new Date(user.createdAt).getTime()) / MS_PER_DAY));

  // Matched + completed counts (user is creator or acceptor).
  const [counts] = await db
    .select({
      matched: sql<number>`count(*) filter (where ${bets.acceptorUserId} is not null)`,
      completed: sql<number>`count(*) filter (where ${bets.status} in ('SETTLED','PAID'))`,
    })
    .from(bets)
    .where(or(eq(bets.creatorUserId, userId), eq(bets.acceptorUserId, userId)));

  // Distinct counterparties across matched bets (sybil-resistant experience).
  const cpRes = await db.execute(sql`
    SELECT count(DISTINCT cp) AS distinct_cp FROM (
      SELECT CASE WHEN b.creator_user_id = ${userId} THEN b.acceptor_user_id
                  ELSE b.creator_user_id END AS cp
      FROM "app"."bets" b
      WHERE (b.creator_user_id = ${userId} OR b.acceptor_user_id = ${userId})
        AND b.acceptor_user_id IS NOT NULL
    ) s WHERE cp IS NOT NULL`);
  const distinctCounterparties = Number(firstRow(cpRes)?.['distinct_cp'] ?? 0);

  // Settled volume, capped per counterparty (kills whale-loop inflation).
  const cap = config.perCounterpartyVolumeCapUsdc;
  const volRes = await db.execute(sql`
    SELECT COALESCE(SUM(LEAST(cp_sum, ${cap})), 0) AS capped FROM (
      SELECT CASE WHEN b.creator_user_id = ${userId} THEN b.acceptor_user_id
                  ELSE b.creator_user_id END AS cp,
             SUM(b.stake_per_side_usdc) AS cp_sum
      FROM "app"."bets" b
      WHERE (b.creator_user_id = ${userId} OR b.acceptor_user_id = ${userId})
        AND b.status IN ('SETTLED','PAID')
      GROUP BY 1
    ) t`);
  const cappedSettledVolumeUsdc = String(firstRow(volRes)?.['capped'] ?? '0');

  const [winRow] = await db
    .select({ n: sql<number>`count(*)` })
    .from(settlements)
    .where(eq(settlements.winnerUserId, userId));
  const [lossRow] = await db
    .select({ n: sql<number>`count(*)` })
    .from(settlements)
    .where(eq(settlements.loserUserId, userId));

  const [frivRow] = await db
    .select({ n: sql<number>`count(*)` })
    .from(disputes)
    .where(and(eq(disputes.openerUserId, userId), eq(disputes.status, 'rejected')));

  // Adverse: an upheld dispute that reversed a result the user benefited from.
  const advRes = await db.execute(sql`
    SELECT count(*) AS n FROM "app"."disputes" d
    JOIN "app"."bets" b ON b.id = d.bet_id
    WHERE d.status = 'upheld'
      AND (b.creator_user_id = ${userId} OR b.acceptor_user_id = ${userId})
      AND d.claimed_winner_user_id <> ${userId}`);

  return {
    distinctCounterparties,
    completedBets: Number(counts?.completed ?? 0),
    matchedBets: Number(counts?.matched ?? 0),
    cappedSettledVolumeUsdc,
    ageDays,
    wins: Number(winRow?.n ?? 0),
    losses: Number(lossRow?.n ?? 0),
    frivolousDisputes: Number(frivRow?.n ?? 0),
    adverseDisputes: Number(firstRow(advRes)?.['n'] ?? 0),
    status: user.status,
  };
}
