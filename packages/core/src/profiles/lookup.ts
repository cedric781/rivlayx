import { and, eq, inArray } from 'drizzle-orm';
import { users } from '@rivlayx/db';
import type { PublicUserSummary } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ProfilesDb = any;

/** Statuses whose profiles are publicly visible. */
const VISIBLE_STATUSES = ['active', 'suspended'] as const;

const PUBLIC_COLUMNS = {
  id: users.id,
  username: users.username,
  displayName: users.displayName,
  joinedAt: users.createdAt,
};

/**
 * Resolve a public profile by username. Returns `null` for unknown handles or
 * users whose profile is not publicly visible (banned / deleted). Only
 * public-safe columns are selected — never email, privyId, or wallets.
 */
export async function getPublicUserByUsername(
  db: ProfilesDb,
  username: string,
): Promise<PublicUserSummary | null> {
  const [row] = await db
    .select(PUBLIC_COLUMNS)
    .from(users)
    .where(
      and(eq(users.username, username.toLowerCase()), inArray(users.status, [...VISIBLE_STATUSES])),
    )
    .limit(1);
  return row ?? null;
}

/** Public-safe summary by user id (used for the signed-in user's own /profile). */
export async function getPublicUserById(
  db: ProfilesDb,
  userId: string,
): Promise<PublicUserSummary | null> {
  const [row] = await db.select(PUBLIC_COLUMNS).from(users).where(eq(users.id, userId)).limit(1);
  return row ?? null;
}
