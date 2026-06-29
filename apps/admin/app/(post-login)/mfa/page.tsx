import { requireSession } from '@rivlayx/auth/next';
import { loadMfaUserState } from '@rivlayx/auth';
import { getDb } from '@/lib/db';
import { MfaForm } from './mfa-form';
import { EnrollForm } from './enroll-form';

export const metadata = { title: 'Two-factor — RivlayX Admin' };

/**
 * Hosted under the (post-login) layout (session required, MFA not required).
 * Branches on enrollment state: a not-yet-enrolled admin sees the authenticator
 * setup flow; an enrolled admin sees the verification prompt.
 */
export default async function MfaPage() {
  const { user } = await requireSession(getDb, {
    app: 'admin',
    requireMfa: false,
    loginPath: '/login',
  });
  const state = await loadMfaUserState(getDb(), user.id);
  const enrolled = Boolean(state?.mfaEnrolledAt);

  return (
    <main style={{ maxWidth: 380, margin: '4rem auto', padding: '0 1rem' }}>
      {enrolled ? (
        <>
          <h1>Two-factor verification</h1>
          <p>Enter the 6-digit code from your authenticator app to access privileged actions.</p>
          <MfaForm />
        </>
      ) : (
        <>
          <h1>Set up two-factor authentication</h1>
          <p>
            Scan the QR code with an authenticator app (Google Authenticator, 1Password, Authy),
            then enter the current code to finish enrollment.
          </p>
          <EnrollForm />
        </>
      )}
    </main>
  );
}
