import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import {
  userRoles,
  users,
  type Database,
  type RoleName,
  type Session,
  type SessionApp,
  type User,
} from '@rivlayx/db';
import { COOKIE_NAMES } from './cookies';
import { defaultLimits, isIdleExpired, isMfaFresh, loadActiveSession, touchSession } from './session';
import { hasMinRole, requiresMfa } from './roles';

export interface AuthContext {
  user: User;
  session: Session;
  roles: RoleName[];
}

export interface SessionGateOptions {
  app: SessionApp;
  minRole?: RoleName;
  /** When undefined: auto — admin app requires MFA for admin/super_admin roles. */
  requireMfa?: boolean;
  /**
   * C5 — when set, MFA must have been verified within this many ms (freshness).
   * When omitted, any prior verification suffices (used by the /mfa flow itself).
   */
  mfaMaxAgeMs?: number;
  loginPath?: string;
  mfaPath?: string;
  forbiddenPath?: string;
}

/**
 * Validate the request's session cookie and return the auth context.
 * Redirects to login / mfa / forbidden when checks fail — caller does not need
 * to handle nulls because `redirect()` throws.
 */
export async function requireSession(
  getDb: () => Database,
  opts: SessionGateOptions,
): Promise<AuthContext> {
  const loginPath = opts.loginPath ?? '/login';
  const mfaPath = opts.mfaPath ?? '/mfa';
  const forbiddenPath = opts.forbiddenPath ?? '/403';

  const cookieStore = await cookies();
  const sessionId = cookieStore.get(COOKIE_NAMES[opts.app])?.value;
  if (!sessionId) {
    redirect(loginPath);
  }

  const db = getDb();
  const session = await loadActiveSession(db, sessionId);
  if (!session || session.app !== opts.app) {
    redirect(loginPath);
  }

  const limits = defaultLimits(opts.app);
  if (isIdleExpired(session, limits)) {
    redirect(loginPath);
  }

  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (!user || user.status !== 'active') {
    redirect(loginPath);
  }

  const rolesRows = await db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.userId, user.id));
  const roles = rolesRows.map((r) => r.role);

  if (opts.minRole && !hasMinRole(roles, opts.minRole)) {
    redirect(forbiddenPath);
  }

  const mfaNeeded = opts.requireMfa ?? (opts.app === 'admin' && requiresMfa(roles));
  if (mfaNeeded) {
    const mfaOk =
      opts.mfaMaxAgeMs != null
        ? isMfaFresh(session, opts.mfaMaxAgeMs)
        : session.mfaVerifiedAt != null;
    if (!mfaOk) {
      redirect(mfaPath);
    }
  }

  // Fire-and-forget last_activity update; don't block render.
  void touchSession(db, session.id);

  return { user, session, roles };
}
