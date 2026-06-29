import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import {
  COOKIE_NAMES,
  can,
  defaultLimits,
  isIdleExpired,
  isMfaFresh,
  loadActiveSession,
  requiresMfaForAction,
  type AdminPermission,
} from '@rivlayx/auth';
import { userRoles, users, type RoleName, type Session, type User } from '@rivlayx/db';
import { getDb } from '@/lib/db';
import { getEnv } from '@/lib/env';

export interface AdminAuthOk {
  ok: true;
  user: User;
  session: Session;
  roles: RoleName[];
  /** Highest privilege role label, suitable for `admin_audit_log.actor_role`. */
  actorRole: RoleName;
}

export interface AdminAuthError {
  ok: false;
  response: NextResponse;
}

export interface RequireAdminApiOptions {
  /** Permission key from `ADMIN_PERMISSIONS`. Caller can act only if `can(roles, permission)` is true. */
  permission: AdminPermission;
}

/**
 * API-route variant of `requireSession`. Returns a JSON error response instead
 * of redirecting. Verifies:
 *
 *   - admin session cookie present + active + not idle-expired
 *   - user record exists + status='active'
 *   - role permits the requested action
 *   - MFA verified, when the action requires it
 */
export async function requireAdminApi(
  options: RequireAdminApiOptions,
): Promise<AdminAuthOk | AdminAuthError> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(COOKIE_NAMES.admin)?.value;
  if (!sessionId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: 'NO_SESSION', message: 'Sign in to the admin app first' } },
        { status: 401 },
      ),
    };
  }

  const db = getDb();
  const session = await loadActiveSession(db, sessionId);
  if (!session || session.app !== 'admin' || isIdleExpired(session, defaultLimits('admin'))) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: 'NO_SESSION', message: 'Session expired' } },
        { status: 401 },
      ),
    };
  }

  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (!user || user.status !== 'active') {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: 'NO_SESSION', message: 'Account inactive' } },
        { status: 401 },
      ),
    };
  }

  const rolesRows = await db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.userId, user.id));
  const roles = rolesRows.map((r) => r.role);

  if (!can(roles, options.permission)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Insufficient privileges' } },
        { status: 403 },
      ),
    };
  }

  if (requiresMfaForAction(options.permission)) {
    const maxAgeMs = getEnv().MFA_MAX_AGE_MINUTES * 60_000;
    if (!isMfaFresh(session, maxAgeMs)) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: { code: 'MFA_REQUIRED', message: 'Re-verify MFA to continue' } },
          { status: 403 },
        ),
      };
    }
  }

  const actorRole =
    (roles.includes('super_admin') && 'super_admin') ||
    (roles.includes('admin') && 'admin') ||
    (roles.includes('moderator') && 'moderator') ||
    'user';

  return { ok: true, user, session, roles, actorRole };
}

/** Extract caller IP from common headers (best-effort). */
export function getRequestIp(request: Request): string | null {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() ?? null;
  return request.headers.get('x-real-ip');
}
