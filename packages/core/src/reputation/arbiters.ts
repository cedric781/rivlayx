import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import { userReputation, users, type ReputationTier } from '@rivlayx/db';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ReputationDb = any;

/** Public-safe top-arbiter row. Never includes the numeric arbiter score. */
export interface TopArbiter {
  userId: string;
  username: string;
  displayName: string | null;
  arbiterTier: ReputationTier;
  arbiterProvisional: boolean;
  arbiterRulings: number;
  /** 0–1 decimal strings. */
  acceptanceRate: string;
  overturnedRate: string;
}

/** Statuses whose arbiter listing is publicly visible. */
const VISIBLE_STATUSES = ['active', 'suspended'] as const;

/**
 * Top arbiters by internal arbiter score, returning only public-safe fields
 * (tier badge + rulings + acceptance/overturned rates — never the raw score).
 * Only users who have actually ruled (`arbiter_rulings > 0`) appear.
 */
export async function listTopArbiters(
  db: ReputationDb,
  opts: { limit?: number } = {},
): Promise<TopArbiter[]> {
  const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
  return db
    .select({
      userId: userReputation.userId,
      username: users.username,
      displayName: users.displayName,
      arbiterTier: userReputation.arbiterTier,
      arbiterProvisional: userReputation.arbiterProvisional,
      arbiterRulings: userReputation.arbiterRulings,
      acceptanceRate: userReputation.arbiterAcceptanceRate,
      overturnedRate: userReputation.arbiterOverturnedRate,
    })
    .from(userReputation)
    .innerJoin(users, eq(users.id, userReputation.userId))
    .where(and(gt(userReputation.arbiterRulings, 0), inArray(users.status, [...VISIBLE_STATUSES])))
    .orderBy(desc(userReputation.arbiterScore))
    .limit(limit);
}
