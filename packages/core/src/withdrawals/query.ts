import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { withdrawalRequests } from '@rivlayx/db';
import type { LedgerDb } from '../ledger/types';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Total USDC a user has withdrawn (or has in-flight) in the trailing 24h —
 * the sum of `processing` + `paid` requests created within the window. Used for
 * the rolling daily cap. Excludes the row identified by `excludeId` (the one
 * being evaluated) so a re-check at process time doesn't count itself.
 */
export async function withdrawnLast24hUsdc(
  db: LedgerDb,
  userId: string,
  now: Date,
  excludeId?: string,
): Promise<string> {
  const since = new Date(now.getTime() - DAY_MS);
  const [row] = await db
    .select({
      total: sql<string>`COALESCE(SUM(${withdrawalRequests.amountUsdc}), 0)`,
    })
    .from(withdrawalRequests)
    .where(
      and(
        eq(withdrawalRequests.userId, userId),
        inArray(withdrawalRequests.status, ['processing', 'paid']),
        gte(withdrawalRequests.createdAt, since),
        excludeId ? sql`${withdrawalRequests.id} <> ${excludeId}` : sql`true`,
      ),
    );
  return row?.total ?? '0';
}
