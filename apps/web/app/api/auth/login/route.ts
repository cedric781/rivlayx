import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  MockAuthProvider,
  buildCookieAttributes,
  createSession,
  defaultLimits,
} from '@rivlayx/auth';
import { getDb } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { UserBannedError, upsertUserFromIdentity } from '@/lib/auth/upsert-user';

const Body = z.object({ email: z.string().email() });

/**
 * Mock-mode email login. Disabled in production — real users go through
 * `/api/auth/privy/callback` which verifies a Privy JWT. The route stays
 * available in dev/test so CI + local flows work without Privy keys.
 */
export async function POST(request: Request) {
  const env = getEnv();
  if (env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Use Privy sign-in' } },
      { status: 404 },
    );
  }

  const json: unknown = await request.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'INVALID_INPUT', message: 'Valid email required' } },
      { status: 400 },
    );
  }

  const provider = new MockAuthProvider();
  let identity;
  try {
    const { token } = await provider.login({ email: parsed.data.email });
    identity = await provider.verify(token);
  } catch {
    return NextResponse.json(
      { error: { code: 'AUTH_FAILED', message: 'Login failed' } },
      { status: 400 },
    );
  }

  const db = getDb();
  let userId: string;
  try {
    userId = await upsertUserFromIdentity(db, identity);
  } catch (err) {
    if (err instanceof UserBannedError) {
      return NextResponse.json(
        { error: { code: 'USER_BANNED', message: 'Account is not active' } },
        { status: 403 },
      );
    }
    throw err;
  }

  const session = await createSession(db, {
    userId,
    app: 'user',
    ip: getIp(request),
    userAgent: request.headers.get('user-agent'),
  });

  const cookie = buildCookieAttributes('user', {
    secure: false, // mock route is dev/test only
    maxAgeSeconds: Math.floor(defaultLimits('user').maxMs / 1000),
  });

  const res = NextResponse.json({ redirect: '/wallet' });
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
