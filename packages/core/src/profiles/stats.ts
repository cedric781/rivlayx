import Decimal from 'decimal.js';
import { eq, sql } from 'drizzle-orm';
import { bets, betParticipants, settlements } from '@rivlayx/db';
import type { ProfileStats } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ProfilesDb = any;

/**
 * Aggregate a user's lifetime betting statistics. Authoritative win/loss data
 * comes from `app.settlements` (one row per settled bet); participation counts
 * and volume come from `app.bet_participants`.
 *
 *   - winnings = Σ(net payout − own stake) on won bets (net profit)
 *   - losses   = Σ(own stake) on lost bets
 *   - winRate  = wins / (wins + losses), 0 when nothing is decided yet
 *   - draws / voids count toward neither wins nor losses
 */
export async function getProfileStats(db: ProfilesDb, userId: string): Promise<ProfileStats> {
  const [participation] = await db
    .select({
      totalBets: sql<number>`count(*)`,
      volume: sql<string>`coalesce(sum(${betParticipants.stakeLockedUsdc}), 0)`,
      openBets: sql<number>`count(*) filter (where ${bets.status} = 'OPEN')`,
      activeBets: sql<number>`count(*) filter (where ${bets.status} = 'ACTIVE')`,
    })
    .from(betParticipants)
    .innerJoin(bets, eq(bets.id, betParticipants.betId))
    .where(eq(betParticipants.userId, userId));

  const [winRow] = await db
    .select({
      wins: sql<number>`count(*)`,
      winnings: sql<string>`coalesce(sum(${settlements.netWinnerUsdc} - ${bets.stakePerSideUsdc}), 0)`,
    })
    .from(settlements)
    .innerJoin(bets, eq(bets.id, settlements.betId))
    .where(eq(settlements.winnerUserId, userId));

  const [lossRow] = await db
    .select({
      losses: sql<number>`count(*)`,
      lossesUsdc: sql<string>`coalesce(sum(${bets.stakePerSideUsdc}), 0)`,
    })
    .from(settlements)
    .innerJoin(bets, eq(bets.id, settlements.betId))
    .where(eq(settlements.loserUserId, userId));

  const wins = Number(winRow?.wins ?? 0);
  const losses = Number(lossRow?.losses ?? 0);
  const decided = wins + losses;
  const winRate = decided === 0 ? 0 : Math.round((wins / decided) * 10000) / 10000;

  return {
    totalBets: Number(participation?.totalBets ?? 0),
    wins,
    losses,
    winRate,
    totalVolumeUsdc: new Decimal(participation?.volume ?? '0').toFixed(6),
    totalWinningsUsdc: new Decimal(winRow?.winnings ?? '0').toFixed(6),
    totalLossesUsdc: new Decimal(lossRow?.lossesUsdc ?? '0').toFixed(6),
    activeBets: Number(participation?.activeBets ?? 0),
    openBets: Number(participation?.openBets ?? 0),
  };
}
