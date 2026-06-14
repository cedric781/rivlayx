import { and, asc, eq, sql } from 'drizzle-orm';
import { riskRecomputeQueue, riskScores, users } from '@rivlayx/db';
import { RISK_DEFAULTS, type RiskConfig } from './config';
import { loadRiskGraph, rebuildRiskGraph, type RiskGraph } from './graph';
import { gatherRiskSignals } from './signals';
import { computeRiskScore } from './score';
import { computeSybilConfidence } from './sybil';
import { raiseClusterAlert, raiseUserAlerts } from './monitor';
import type { RiskResult } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RiskDb = any;

function rowsOf(res: unknown): Array<Record<string, unknown>> {
  return (
    (res as { rows?: Array<Record<string, unknown>> }).rows ??
    (Array.isArray(res) ? (res as Array<Record<string, unknown>>) : [])
  );
}

/** Gather → score → upsert snapshot → raise alerts for one user. */
export async function recomputeUserRisk(
  db: RiskDb,
  userId: string,
  graph: RiskGraph,
  config: RiskConfig = RISK_DEFAULTS,
): Promise<RiskResult> {
  const gathered = await gatherRiskSignals(db, userId, graph, config);
  const result = computeRiskScore(gathered.input, config);
  const now = new Date();

  const values = {
    riskScore: result.riskScore,
    riskBand: result.band,
    ringScore: result.subScores.ring,
    arbiterConcentrationScore: result.subScores.arbiterConcentration,
    concentrationScore: result.subScores.concentration,
    washScore: result.subScores.wash,
    abuseScore: result.subScores.abuse,
    velocityScore: result.subScores.velocity,
    fundingOverlapScore: result.subScores.fundingOverlap,
    ringClusterId: gathered.ringClusterId,
    components: {
      subScores: result.subScores,
      primary: result.primary,
      fundingBoost: result.fundingBoost,
      activityGated: result.activityGated,
      washCounterpartyId: gathered.washCounterpartyId,
      ...gathered.evidence,
    },
    computedAt: now,
    updatedAt: now,
  };

  await db
    .insert(riskScores)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: riskScores.userId, set: values });

  await raiseUserAlerts(db, userId, result, gathered.evidence, config);
  return result;
}

export interface RiskWorkerResult {
  processed: number;
  failed: number;
}

/** Drain the work queue (user subjects). Each user is isolated on failure. */
export async function runRiskWorker(
  db: RiskDb,
  opts: { limit?: number; graph?: RiskGraph; config?: RiskConfig } = {},
): Promise<RiskWorkerResult> {
  const config = opts.config ?? RISK_DEFAULTS;
  const graph = opts.graph ?? (await loadRiskGraph(db, config));
  const limit = opts.limit ?? 200;

  const queued = await db
    .select({
      subjectType: riskRecomputeQueue.subjectType,
      subjectId: riskRecomputeQueue.subjectId,
      enqueuedAt: riskRecomputeQueue.enqueuedAt,
    })
    .from(riskRecomputeQueue)
    .where(eq(riskRecomputeQueue.subjectType, 'user'))
    .orderBy(asc(riskRecomputeQueue.enqueuedAt))
    .limit(limit);

  let processed = 0;
  let failed = 0;
  for (const row of queued) {
    try {
      await recomputeUserRisk(db, row.subjectId, graph, config);
      await db
        .delete(riskRecomputeQueue)
        .where(
          and(
            eq(riskRecomputeQueue.subjectType, 'user'),
            eq(riskRecomputeQueue.subjectId, row.subjectId),
            eq(riskRecomputeQueue.enqueuedAt, row.enqueuedAt),
          ),
        );
      processed++;
    } catch {
      failed++;
    }
  }
  return { processed, failed };
}

/** Compact pure helpers for cluster-level sybil features (no I/O here). */
function modeShare(counts: number[]): number {
  const total = counts.reduce((s, c) => s + c, 0);
  const max = counts.reduce((m, c) => Math.max(m, c), 0);
  return total > 0 ? max / total : 0;
}

/** Behavioural sybil features for one cluster (read-only). */
async function gatherClusterSybil(db: RiskDb, members: string[]): Promise<{
  confidence: number;
  signalsHit: string[];
}> {
  const memberList = sql.join(
    members.map((m) => sql`${m}`),
    sql`, `,
  );

  const userRows = rowsOf(
    await db.execute(sql`
      SELECT u.username AS username, extract(epoch from u.created_at) AS created_epoch
      FROM "auth"."users" u WHERE u.id IN (${memberList})`),
  );
  const epochs = userRows.map((r) => Number(r['created_epoch'] ?? 0)).sort((a, b) => a - b);
  // Largest count of creations within a 24h window.
  let burst = 1;
  for (let i = 0; i < epochs.length; i++) {
    let j = i;
    while (j < epochs.length && epochs[j]! - epochs[i]! <= 86_400) j++;
    burst = Math.max(burst, j - i);
  }
  const creationBurstRatio = epochs.length > 0 ? burst / epochs.length : 0;

  // Username prefix clustering (first 2 chars).
  const prefixCounts = new Map<string, number>();
  for (const r of userRows) {
    const name = String(r['username'] ?? '');
    const key = name.slice(0, 2);
    prefixCounts.set(key, (prefixCounts.get(key) ?? 0) + 1);
  }
  const usernamePatternScore = modeShare([...prefixCounts.values()]);

  const stakeRows = rowsOf(
    await db.execute(sql`
      SELECT b.stake_per_side_usdc AS stake, count(*) AS c
      FROM "app"."bets" b WHERE b.creator_user_id IN (${memberList}) GROUP BY 1`),
  );
  const stakeSimilarity = modeShare(stakeRows.map((r) => Number(r['c'] ?? 0)));

  const tmplRows = rowsOf(
    await db.execute(sql`
      SELECT COALESCE(b.template_id, 'none') AS tmpl, count(*) AS c
      FROM "app"."bets" b WHERE b.creator_user_id IN (${memberList}) GROUP BY 1`),
  );
  const templateSimilarity = modeShare(tmplRows.map((r) => Number(r['c'] ?? 0)));

  return computeSybilConfidence({
    groupSize: members.length,
    creationBurstRatio,
    usernamePatternScore,
    stakeSimilarity,
    templateSimilarity,
  });
}

export interface RiskCycleResult {
  recomputed: number;
  failed: number;
  clusters: number;
  enqueued?: number;
}

/**
 * Cron entry point. Default: scan recent activity then drain the queue.
 * `full`: rebuild the graph, recompute every user, and raise cluster-level ring
 * + sybil alerts. Shadow mode — scores and alerts only, never an action.
 */
export async function runRiskCycle(
  db: RiskDb,
  opts: { full?: boolean; limit?: number; config?: RiskConfig } = {},
): Promise<RiskCycleResult> {
  const config = opts.config ?? RISK_DEFAULTS;

  if (!opts.full) {
    const { scanRecentActivity } = await import('./scanner');
    const scan = await scanRecentActivity(db);
    const w = await runRiskWorker(db, { limit: opts.limit, config });
    return { recomputed: w.processed, failed: w.failed, clusters: 0, enqueued: scan.enqueued };
  }

  const graph = await rebuildRiskGraph(db, config);
  const allUsers = await db.select({ id: users.id }).from(users);
  let recomputed = 0;
  let failed = 0;
  for (const u of allUsers) {
    try {
      await recomputeUserRisk(db, u.id, graph, config);
      recomputed++;
    } catch {
      failed++;
    }
  }

  // Cluster-level alerts: ring (max member ring sub-score) + behavioural sybil.
  let clusters = 0;
  for (const [clusterId, members] of graph.clusters) {
    clusters++;
    const scoreRows = await db
      .select({ ring: riskScores.ringScore })
      .from(riskScores)
      .where(eq(riskScores.ringClusterId, clusterId));
    const clusterRing = scoreRows.reduce((m: number, r: { ring: number }) => Math.max(m, r.ring), 0);
    if (clusterRing >= config.alertThresholds.ring) {
      await raiseClusterAlert(db, clusterId, 'ring', clusterRing, { members, clusterRing }, config);
    }

    try {
      const sybil = await gatherClusterSybil(db, members);
      const sybilScore = Math.round(100 * sybil.confidence);
      if (sybilScore >= config.alertThresholds.sybil) {
        await raiseClusterAlert(db, clusterId, 'sybil', sybilScore, {
          members,
          signalsHit: sybil.signalsHit,
        }, config);
        await db
          .update(riskScores)
          .set({ sybilClusterId: clusterId })
          .where(eq(riskScores.ringClusterId, clusterId));
      }
    } catch {
      // sybil is best-effort; never blocks the cycle.
    }
  }

  return { recomputed, failed, clusters };
}
