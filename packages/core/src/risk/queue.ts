import { riskRecomputeQueue, type RiskRefreshReason, type RiskSubjectType } from '@rivlayx/db';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RiskDb = any;

/**
 * Enqueue a risk recompute (dedup upsert). NOTE: unlike reputation, this is
 * **not** called from inside money-path transactions — the scanner populates
 * the queue from observed activity, keeping settlement/deposit code untouched.
 */
export async function enqueueRiskRecompute(
  db: RiskDb,
  subjectId: string,
  reason: RiskRefreshReason,
  subjectType: RiskSubjectType = 'user',
): Promise<void> {
  await db
    .insert(riskRecomputeQueue)
    .values({ subjectType, subjectId, reason, enqueuedAt: new Date() })
    .onConflictDoUpdate({
      target: [riskRecomputeQueue.subjectType, riskRecomputeQueue.subjectId],
      set: { reason, enqueuedAt: new Date() },
    });
}
