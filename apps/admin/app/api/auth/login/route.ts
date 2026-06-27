import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { userRoles } from '@rivlayx/db';
import {
  buildCookieAttributes,
  createSession,
  defaultLimits,
  hasMinRole,
  requiresMfa,
  verifyAdminCredentials,
} from '@rivlayx/auth';
import { getDb } from '@/lib/db';
import { getEnv } from '@/lib/env';

const Body = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(request: Request) {
  const json: unknown = await request.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'INVALID_INPUT', message: 'Email and password are required' } },
      { status: 400 },
    );
  }

  const db = getDb();

  // First factor: real credential verification (replaces the dev-only
  // email-only mock provider). Fail-closed — unknown email, no password set, or
  // a wrong password all return the same generic rejection. MFA (below) is
  // unchanged.
  const credential = await verifyAdminCredentials(db, {
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (!credential.ok) {
    return NextResponse.json(
      { error: { code: 'AUTH_FAILED', message: 'Invalid email or password' } },
      { status: 401 },
    );
  }
  const user = credential.user;

  if (user.status !== 'active') {
    return NextResponse.json(
      { error: { code: 'USER_BANNED', message: 'Account is not active' } },
      { status: 403 },
    );
  }

  const rolesRows = await db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.userId, user.id));
  const roles = rolesRows.map((r) => r.role);

  if (!hasMinRole(roles, 'moderator')) {
    return NextResponse.json(
      { error: { code: 'NOT_AUTHORIZED', message: 'Admin access not granted' } },
      { status: 403 },
    );
  }

  const session = await createSession(db, {
    userId: user.id,
    app: 'admin',
    ip: getIp(request),
    userAgent: request.headers.get('user-agent'),
  });

  const env = getEnv();
  const cookie = buildCookieAttributes('admin', {
    secure: env.NODE_ENV === 'production',
    maxAgeSeconds: Math.floor(defaultLimits('admin').maxMs / 1000),
  });

  const res = NextResponse.json({
    redirect: requiresMfa(roles) ? '/mfa' : '/dashboard',
  });
  res.cookies.set(cookie.name, session.id, {
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite,
    path: cookie.path,
    maxAge: cookie.maxAge,
  });
  return res;
}

function getIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() ?? null;
  return req.headers.get('x-real-ip');
}
