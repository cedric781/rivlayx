import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { riskAlerts, riskRecomputeQueue, riskScores, users, type RiskAlertType, type RiskBand } from '@rivlayx/db';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RiskDb = any;

export interface TopRiskUser {
  userId: string;
  username: string;
  riskScore: number;
  riskBand: RiskBand;
  ringScore: number;
  arbiterConcentrationScore: number;
  concentrationScore: number;
  washScore: number;
  abuseScore: number;
  velocityScore: number;
  fundingOverlapScore: number;
}

/** Top risk users for the admin dashboard (internal — never public). */
export async function listTopRiskUsers(db: RiskDb, opts: { limit?: number } = {}): Promise<TopRiskUser[]> {
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
  return db
    .select({
      userId: riskScores.userId,
      username: users.username,
      riskScore: riskScores.riskScore,
      riskBand: riskScores.riskBand,
      ringScore: riskScores.ringScore,
      arbiterConcentrationScore: riskScores.arbiterConcentrationScore,
      concentrationScore: riskScores.concentrationScore,
      washScore: riskScores.washScore,
      abuseScore: riskScores.abuseScore,
      velocityScore: riskScores.velocityScore,
      fundingOverlapScore: riskScores.fundingOverlapScore,
    })
    .from(riskScores)
    .innerJoin(users, eq(users.id, riskScores.userId))
    .orderBy(desc(riskScores.riskScore))
    .limit(limit);
}

export interface OpenAlert {
  id: string;
  subjectType: string;
  subjectId: string;
  type: RiskAlertType;
  severity: RiskBand;
  score: number;
  evidence: unknown;
  createdAt: Date;
}

/** Open alerts (most severe / recent first), optionally filtered by type. */
export async function listOpenAlerts(
  db: RiskDb,
  opts: { limit?: number; type?: RiskAlertType } = {},
): Promise<OpenAlert[]> {
  const limit = Math.min(200, Math.max(1, opts.limit ?? 100));
  const where = opts.type
    ? and(eq(riskAlerts.status, 'open'), eq(riskAlerts.type, opts.type))
    : eq(riskAlerts.status, 'open');
  return db
    .select({
      id: riskAlerts.id,
      subjectType: riskAlerts.subjectType,
      subjectId: riskAlerts.subjectId,
      type: riskAlerts.type,
      severity: riskAlerts.severity,
      score: riskAlerts.score,
      evidence: riskAlerts.evidence,
      createdAt: riskAlerts.createdAt,
    })
    .from(riskAlerts)
    .where(where)
    .orderBy(desc(riskAlerts.score), desc(riskAlerts.createdAt))
    .limit(limit);
}

export interface RiskCluster {
  clusterId: string;
  memberCount: number;
  maxRingScore: number;
}

/** Ring clusters with size + peak ring score. */
export async function listRingClusters(db: RiskDb, opts: { limit?: number } = {}): Promise<RiskCluster[]> {
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
  const rows = await db
    .select({
      clusterId: riskScores.ringClusterId,
      memberCount: sql<number>`count(*)`,
      maxRingScore: sql<number>`max(${riskScores.ringScore})`,
    })
    .from(riskScores)
    .where(isNotNull(riskScores.ringClusterId))
    .groupBy(riskScores.ringClusterId)
    .orderBy(desc(sql`max(${riskScores.ringScore})`))
    .limit(limit);
  return rows.map((r: { clusterId: string; memberCount: number; maxRingScore: number }) => ({
    clusterId: r.clusterId,
    memberCount: Number(r.memberCount),
    maxRingScore: Number(r.maxRingScore),
  }));
}

export interface RiskAnalytics {
  bandDistribution: Array<{ band: string; count: number }>;
  openAlertsByType: Array<{ type: string; count: number }>;
  queueDepth: number;
  ringClusters: number;
}

/** Aggregate risk health for the admin dashboard (internal). */
export async function getRiskAnalytics(db: RiskDb): Promise<RiskAnalytics> {
  const bandRows = await db
    .select({ band: riskScores.riskBand, count: sql<number>`count(*)` })
    .from(riskScores)
    .groupBy(riskScores.riskBand);

  const alertRows = await db
    .select({ type: riskAlerts.type, count: sql<number>`count(*)` })
    .from(riskAlerts)
    .where(eq(riskAlerts.status, 'open'))
    .groupBy(riskAlerts.type);

  const [queue] = await db.select({ n: sql<number>`count(*)` }).from(riskRecomputeQueue);

  const [clusters] = await db
    .select({ n: sql<number>`count(distinct ${riskScores.ringClusterId})` })
    .from(riskScores)
    .where(isNotNull(riskScores.ringClusterId));

  return {
    bandDistribution: bandRows.map((r: { band: string; count: number }) => ({
      band: r.band,
      count: Number(r.count),
    })),
    openAlertsByType: alertRows.map((r: { type: string; count: number }) => ({
      type: r.type,
      count: Number(r.count),
    })),
    queueDepth: Number(queue?.n ?? 0),
    ringClusters: Number(clusters?.n ?? 0),
  };
}
