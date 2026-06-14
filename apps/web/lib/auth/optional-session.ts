import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { COOKIE_NAMES, defaultLimits, isIdleExpired, loadActiveSession } from '@rivlayx/auth';
import { users, type User } from '@rivlayx/db';
import { getDb } from '@/lib/db';

/**
 * Resolve the current user app session without redirecting. For public pages
 * (e.g. bet detail) that render differently for signed-in vs anonymous viewers.
 * Returns `null` when there is no valid, active user session.
 */
export async function getOptionalUser(): Promise<User | null> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(COOKIE_NAMES.user)?.value;
  if (!sessionId) return null;

  const db = getDb();
  const session = await loadActiveSession(db, sessionId);
  if (!session || session.app !== 'user' || isIdleExpired(session, defaultLimits('user'))) {
    return null;
  }

  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (!user || user.status !== 'active') return null;
  return user;
}
