import { NextResponse } from 'next/server';
import { z } from 'zod';
import { buildCookieAttributes, createSession, defaultLimits } from '@rivlayx/auth';
import { getDb } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { getAuthProvider } from '@/lib/auth/get-provider';
import { UserBannedError, upsertUserFromIdentity } from '@/lib/auth/upsert-user';

const Body = z.object({ token: z.string().min(20).max(4096) });

export async function POST(request: Request) {
  const json: unknown = await request.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'INVALID_INPUT', message: 'Token required' } },
      { status: 400 },
    );
  }

  const provider = await getAuthProvider();
  let identity;
  try {
    identity = await provider.verify(parsed.data.token);
  } catch {
    return NextResponse.json(
      { error: { code: 'AUTH_FAILED', message: 'Token verification failed' } },
      { status: 401 },
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

  const env = getEnv();
  const cookie = buildCookieAttributes('user', {
    secure: env.NODE_ENV === 'production',
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
