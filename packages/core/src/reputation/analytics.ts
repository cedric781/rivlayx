import { desc, eq, gt, sql } from 'drizzle-orm';
import { reputationRecomputeQueue, userReputation, users } from '@rivlayx/db';
import { listTopArbiters, type TopArbiter } from './arbiters';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ReputationDb = any;

export interface OverturnedArbiter {
  username: string;
  arbiterTier: string;
  arbiterRulings: number;
  overturnedRate: string;
}

export interface ReputationAnalytics {
  /** Count of snapshots per bettor tier. */
  tierDistribution: Array<{ tier: string; count: number }>;
  provisionalUsers: number;
  /** Pending refreshes in the outbox. */
  queueDepth: number;
  /** Snapshots with a win-rate anomaly flag. */
  anomalyCount: number;
  topArbiters: TopArbiter[];
  /** Arbiters with any overturned rulings, worst first. */
  overturnedArbiters: OverturnedArbiter[];
}

/** Aggregate reputation health for the admin dashboard (internal). */
export async function getReputationAnalytics(db: ReputationDb): Promise<ReputationAnalytics> {
  const tierRows = await db
    .select({ tier: userReputation.tier, count: sql<number>`count(*)` })
    .from(userReputation)
    .groupBy(userReputation.tier);

  const [prov] = await db
    .select({ n: sql<number>`count(*)` })
    .from(userReputation)
    .where(eq(userReputation.provisional, true));

  const [queue] = await db.select({ n: sql<number>`count(*)` }).from(reputationRecomputeQueue);

  const [anom] = await db
    .select({ n: sql<number>`count(*)` })
    .from(userReputation)
    .where(sql`${userReputation.components} ->> 'winRateAnomaly' = 'true'`);

  const topArbiters = await listTopArbiters(db, { limit: 10 });

  const overturnedArbiters: OverturnedArbiter[] = await db
    .select({
      username: users.username,
      arbiterTier: userReputation.arbiterTier,
      arbiterRulings: userReputation.arbiterRulings,
      overturnedRate: userReputation.arbiterOverturnedRate,
    })
    .from(userReputation)
    .innerJoin(users, eq(users.id, userReputation.userId))
    .where(gt(userReputation.arbiterOverturnedRate, '0'))
    .orderBy(desc(userReputation.arbiterOverturnedRate))
    .limit(10);

  return {
    tierDistribution: tierRows.map((r: { tier: string; count: number }) => ({
      tier: r.tier,
      count: Number(r.count),
    })),
    provisionalUsers: Number(prov?.n ?? 0),
    queueDepth: Number(queue?.n ?? 0),
    anomalyCount: Number(anom?.n ?? 0),
    topArbiters,
    overturnedArbiters,
  };
}
