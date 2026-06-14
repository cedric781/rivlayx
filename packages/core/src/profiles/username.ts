import { eq, sql } from 'drizzle-orm';
import { users } from '@rivlayx/db';
import { USERNAME_MAX, isValidUsername, normalizeUsernameBase } from '@rivlayx/shared';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ProfilesDb = any;

async function usernameExists(db: ProfilesDb, candidate: string): Promise<boolean> {
  const [row] = await db
    .select({ one: sql<number>`1` })
    .from(users)
    .where(eq(users.username, candidate))
    .limit(1);
  return Boolean(row);
}

/**
 * Derive a unique, format-valid public username from a preferred string
 * (e.g. an email local-part or display name). Tries the normalized base first,
 * then appends an incrementing numeric suffix until a free handle is found.
 *
 * Pass the same transaction handle used for the surrounding insert so the
 * availability check and the insert agree; the `users_username_unique`
 * constraint is the final guard against concurrent races.
 */
export async function generateUniqueUsername(db: ProfilesDb, preferred: string): Promise<string> {
  const normalized = normalizeUsernameBase(preferred);
  const base = normalized.length >= 3 ? normalized : `user_${normalized}`.slice(0, USERNAME_MAX);

  for (let i = 0; i < 100; i++) {
    const suffix = i === 0 ? '' : String(i + 1);
    const candidate = base.slice(0, USERNAME_MAX - suffix.length) + suffix;
    if (isValidUsername(candidate) && !(await usernameExists(db, candidate))) {
      return candidate;
    }
  }

  // Practically unreachable; fall back to a random-ish handle.
  for (let i = 0; i < 1000; i++) {
    const candidate = `user_${i}_${base}`.slice(0, USERNAME_MAX);
    if (isValidUsername(candidate) && !(await usernameExists(db, candidate))) {
      return candidate;
    }
  }
  throw new Error('could not allocate a unique username');
}
