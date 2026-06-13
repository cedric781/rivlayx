import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { COOKIE_NAMES, loadActiveSession, markMfaVerified } from '@rivlayx/auth';
import { getDb } from '@/lib/db';

const Body = z.object({ code: z.string().regex(/^[0-9]{6}$/) });

export async function POST(request: Request) {
  const json: unknown = await request.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'INVALID_INPUT', message: '6-digit code required' } },
      { status: 400 },
    );
  }

  const cookieStore = await cookies();
  const sessionId = cookieStore.get(COOKIE_NAMES.admin)?.value;
  if (!sessionId) {
    return NextResponse.json(
      { error: { code: 'NO_SESSION', message: 'Sign in first' } },
      { status: 401 },
    );
  }

  const db = getDb();
  const session = await loadActiveSession(db, sessionId);
  if (!session || session.app !== 'admin') {
    return NextResponse.json(
      { error: { code: 'NO_SESSION', message: 'Sign in first' } },
      { status: 401 },
    );
  }

  // Mock mode: any 6-digit code passes. Replace with TOTP / Privy MFA in Sprint 8+.
  await markMfaVerified(db, session.id);
  return NextResponse.json({ ok: true });
}
