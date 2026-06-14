import { reputationRecomputeQueue, type ReputationRefreshReason } from '@rivlayx/db';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ReputationDb = any;

/**
 * Schedule a reputation recompute for `userId` (transactional outbox). Call this
 * **inside** the money-path transaction (settlement / dispute ruling /
 * moderation): it is a single dedup upsert — no aggregation, no scoring — so the
 * money-path never depends on reputation computation. A worker drains the queue
 * out-of-band. Repeated enqueues for the same user collapse to one pending row.
 */
export async function enqueueReputationRefresh(
  tx: ReputationDb,
  userId: string,
  reason: ReputationRefreshReason,
): Promise<void> {
  await tx
    .insert(reputationRecomputeQueue)
    .values({ userId, reason, enqueuedAt: new Date() })
    .onConflictDoUpdate({
      target: reputationRecomputeQueue.userId,
      set: { reason, enqueuedAt: new Date() },
    });
}
