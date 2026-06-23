import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import QRCode from 'qrcode';
import {
  COOKIE_NAMES,
  buildEnrollment,
  loadActiveSession,
  loadMfaUserState,
  storePendingMfaSecret,
} from '@rivlayx/auth';
import { getDb } from '@/lib/db';
import { getEnv } from '@/lib/env';

/**
 * Begin TOTP enrollment: generate a secret, store it encrypted (not yet
 * enrolled), and return the otpauth URI + a QR data-URL for the authenticator
 * app. Enrollment completes when the first valid code is POSTed to
 * `/api/auth/mfa/verify`. Re-enrollment of an already-enrolled admin is refused
 * here (a deliberate reset flow is out of scope for C5).
 */
export async function POST() {
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
  if (user.mfaEnrolledAt) {
    return NextResponse.json(
      { error: { code: 'MFA_ALREADY_ENROLLED', message: 'Authenticator already enrolled' } },
      { status: 409 },
    );
  }

  const enrollment = buildEnrollment({
    accountName: user.email,
    issuer: env.MFA_ISSUER,
    encryptionKey: env.MFA_ENCRYPTION_KEY,
  });
  await storePendingMfaSecret(db, user.id, enrollment.encryptedSecret);

  const qrDataUrl = await QRCode.toDataURL(enrollment.otpauthUri);
  return NextResponse.json({ otpauthUri: enrollment.otpauthUri, qrDataUrl });
}
