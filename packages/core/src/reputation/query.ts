import { eq, inArray } from 'drizzle-orm';
import { userReputation, type UserReputation } from '@rivlayx/db';
import type { PublicReputation } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ReputationDb = any;

/** Default for users without a snapshot yet — safe before/independent of backfill. */
const DEFAULT_PUBLIC: PublicReputation = { tier: 'new', provisional: true };

/** Public-safe reputation (tier + provisional) for one user. Never the score. */
export async function getReputation(db: ReputationDb, userId: string): Promise<PublicReputation> {
  const [row] = await db
    .select({ tier: userReputation.tier, provisional: userReputation.provisional })
    .from(userReputation)
    .where(eq(userReputation.userId, userId))
    .limit(1);
  return row ?? DEFAULT_PUBLIC;
}

/** Batched public reputation lookup; missing users fall back to the default. */
export async function getReputationMany(
  db: ReputationDb,
  userIds: string[],
): Promise<Map<string, PublicReputation>> {
  const map = new Map<string, PublicReputation>();
  if (userIds.length === 0) return map;
  const rows = await db
    .select({ userId: userReputation.userId, tier: userReputation.tier, provisional: userReputation.provisional })
    .from(userReputation)
    .where(inArray(userReputation.userId, userIds));
  for (const r of rows as Array<{ userId: string; tier: PublicReputation['tier']; provisional: boolean }>) {
    map.set(r.userId, { tier: r.tier, provisional: r.provisional });
  }
  return map;
}

/** Full snapshot incl. score + components (internal: T&S / leaderboard / debug). */
export async function getReputationDetail(
  db: ReputationDb,
  userId: string,
): Promise<UserReputation | null> {
  const [row] = await db
    .select()
    .from(userReputation)
    .where(eq(userReputation.userId, userId))
    .limit(1);
  return row ?? null;
}
