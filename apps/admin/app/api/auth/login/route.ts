import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { userRoles, users } from '@rivlayx/db';
import {
  MockAuthProvider,
  buildCookieAttributes,
  createSession,
  defaultLimits,
  hasMinRole,
  requiresMfa,
} from '@rivlayx/auth';
import { getDb } from '@/lib/db';
import { getEnv } from '@/lib/env';

const provider = new MockAuthProvider();
const Body = z.object({ email: z.string().email() });

export async function POST(request: Request) {
  const json: unknown = await request.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'INVALID_INPUT', message: 'Valid email required' } },
      { status: 400 },
    );
  }

  let identity;
  try {
    const { token } = await provider.login({ email: parsed.data.email });
    identity = await provider.verify(token);
  } catch {
    return NextResponse.json(
      { error: { code: 'AUTH_FAILED', message: 'Sign-in failed' } },
      { status: 400 },
    );
  }

  const db = getDb();
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.privyId, identity.externalId))
    .limit(1);

  // Admin app NEVER creates new users on login — must be provisioned first.
  if (!user) {
    return NextResponse.json(
      {
        error: {
          code: 'NOT_AUTHORIZED',
          message: 'Account not provisioned for admin access',
        },
      },
      { status: 403 },
    );
  }
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
