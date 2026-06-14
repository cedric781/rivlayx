import { and, asc, eq } from 'drizzle-orm';
import { reputationRecomputeQueue, userReputation, users } from '@rivlayx/db';
import { gatherArbiterSignals, gatherReputationSignals } from './signals';
import { computeArbiterReputation, computeReputation } from './score';
import type { ReputationResult } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ReputationDb = any;

/** Gather → score → upsert the snapshot for one user. */
export async function recomputeUserReputation(
  db: ReputationDb,
  userId: string,
): Promise<ReputationResult> {
  const signals = await gatherReputationSignals(db, userId);
  const result = computeReputation(signals);
  const arbiterSignals = await gatherArbiterSignals(db, userId);
  const arbiter = computeArbiterReputation(arbiterSignals);
  const now = new Date();

  const values = {
    score: result.score,
    tier: result.tier,
    provisional: result.provisional,
    components: result.components,
    arbiterScore: arbiter.arbiterScore,
    arbiterTier: arbiter.arbiterTier,
    arbiterProvisional: arbiter.arbiterProvisional,
    arbiterRulings: arbiter.arbiterRulings,
    arbiterOverturnedRate: arbiter.overturnedRate.toFixed(4),
    arbiterAcceptanceRate: arbiter.acceptanceRate.toFixed(4),
    computedAt: now,
    updatedAt: now,
  };

  await db
    .insert(userReputation)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: userReputation.userId, set: values });
  return result;
}

export interface ReputationWorkerOptions {
  limit?: number;
}
export interface ReputationWorkerResult {
  processed: number;
  failed: number;
  userIds: string[];
}

/**
 * Drain the recompute outbox: recompute each queued user, then remove its row
 * (only if it was not re-enqueued mid-flight — guarded on `enqueued_at`). Each
 * user is isolated, so one failure never blocks the rest.
 */
export async function runReputationWorker(
  db: ReputationDb,
  opts: ReputationWorkerOptions = {},
): Promise<ReputationWorkerResult> {
  const limit = opts.limit ?? 100;
  const queued = await db
    .select({
      userId: reputationRecomputeQueue.userId,
      enqueuedAt: reputationRecomputeQueue.enqueuedAt,
    })
    .from(reputationRecomputeQueue)
    .orderBy(asc(reputationRecomputeQueue.enqueuedAt))
    .limit(limit);

  let processed = 0;
  let failed = 0;
  const userIds: string[] = [];
  for (const row of queued) {
    try {
      await recomputeUserReputation(db, row.userId);
      await db
        .delete(reputationRecomputeQueue)
        .where(
          and(
            eq(reputationRecomputeQueue.userId, row.userId),
            eq(reputationRecomputeQueue.enqueuedAt, row.enqueuedAt),
          ),
        );
      processed++;
      userIds.push(row.userId);
    } catch {
      failed++;
    }
  }
  return { processed, failed, userIds };
}

export interface ReputationCycleOptions {
  /** Recompute every user (backfill / nightly safety sweep). */
  full?: boolean;
  limit?: number;
}
export interface ReputationCycleResult {
  recomputed: number;
  failed: number;
}

/**
 * Cron entry point. Default: drain the outbox (worker). `full`: recompute every
 * user — used for the one-off backfill and the nightly safety sweep.
 */
export async function runReputationCycle(
  db: ReputationDb,
  opts: ReputationCycleOptions = {},
): Promise<ReputationCycleResult> {
  if (!opts.full) {
    const w = await runReputationWorker(db, { limit: opts.limit });
    return { recomputed: w.processed, failed: w.failed };
  }
  const allUsers = await db.select({ id: users.id }).from(users);
  let recomputed = 0;
  let failed = 0;
  for (const u of allUsers) {
    try {
      await recomputeUserReputation(db, u.id);
      recomputed++;
    } catch {
      failed++;
    }
  }
  return { recomputed, failed };
}
