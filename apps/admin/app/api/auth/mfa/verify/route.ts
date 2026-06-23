import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import {
  COOKIE_NAMES,
  applyMfaFailure,
  applyMfaSuccess,
  evaluateMfaAttempt,
  loadActiveSession,
  loadMfaUserState,
} from '@rivlayx/auth';
import { getDb } from '@/lib/db';
import { getEnv } from '@/lib/env';

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

  const env = getEnv();
  if (!env.MFA_ENCRYPTION_KEY) {
    return NextResponse.json(
      { error: { code: 'MFA_NOT_CONFIGURED', message: 'MFA encryption key is not configured' } },
      { status: 500 },
    );
  }

  const user = await loadMfaUserState(db, session.userId);
  if (!user) {
    return NextResponse.json(
      { error: { code: 'NO_SESSION', message: 'Account not found' } },
      { status: 401 },
    );
  }

  const now = new Date();
  const result = evaluateMfaAttempt({ user, code: parsed.data.code, now, encryptionKey: env.MFA_ENCRYPTION_KEY });

  switch (result.outcome) {
    case 'ok':
      await applyMfaSuccess(db, {
        userId: user.id,
        sessionId: session.id,
        step: result.step!,
        completesEnrollment: result.completesEnrollment ?? false,
        now,
      });
      return NextResponse.json({ ok: true, enrolled: result.completesEnrollment ?? false });

    case 'not_enrolled':
      return NextResponse.json(
        { error: { code: 'MFA_NOT_ENROLLED', message: 'Enroll an authenticator first' } },
        { status: 409 },
      );

    case 'locked':
      return NextResponse.json(
        { error: { code: 'MFA_LOCKED', message: 'Too many attempts — try again later' } },
        { status: 429 },
      );

    case 'invalid':
    case 'replay': {
      await applyMfaFailure(db, {
        userId: user.id,
        failedAttempts: result.nextFailedAttempts!,
        lockedUntil: result.nextLockedUntil ?? null,
      });
      const locked = result.nextLockedUntil != null;
      return NextResponse.json(
        {
          error: {
            code: locked ? 'MFA_LOCKED' : 'MFA_INVALID',
            message: locked ? 'Too many attempts — try again later' : 'Invalid code',
          },
        },
        { status: locked ? 429 : 401 },
      );
    }

    default:
      return NextResponse.json(
        { error: { code: 'MFA_ERROR', message: 'Could not verify code' } },
        { status: 500 },
      );
  }
}
