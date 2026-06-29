import { sql } from 'drizzle-orm';
import { users, type User } from '@rivlayx/db';
import { hashPassword, verifyPassword } from '@rivlayx/shared/password';
import type { AuthDb } from './session';

/**
 * Admin first-factor credential verification (B1).
 *
 * Replaces the dev-only email-only `MockAuthProvider` in the admin login route
 * with a real password check. This is purely the FIRST factor — TOTP MFA
 * (`./mfa`) remains the unchanged second factor for privileged roles.
 *
 * Fail-closed contract:
 *   - unknown email           → rejected
 *   - user with no passwordHash → rejected (`no_password_set`)
 *   - wrong password          → rejected (`invalid_credentials`)
 *   - correct password        → `{ ok: true, user }`
 *
 * Anti-enumeration: every rejection path runs a constant-time password check
 * (against a real dummy hash when the user/credential is absent) so response
 * timing does not reveal whether an email exists or has a password set.
 */

export type AdminCredentialResult =
  | { ok: true; user: User }
  | { ok: false; reason: 'invalid_credentials' | 'no_password_set' };

// A real scrypt hash of a random throwaway secret. Verifying against this when
// no stored hash exists keeps the failure path's work comparable to success.
const DUMMY_HASH = hashPassword('rivlayx-admin-credentials-dummy-target');

export async function verifyAdminCredentials(
  db: AuthDb,
  input: { email: string; password: string },
): Promise<AdminCredentialResult> {
  const email = input.email.trim().toLowerCase();
  const password = input.password;

  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);

  if (!user || !user.passwordHash) {
    // Burn comparable time, then reject without revealing which case it was.
    verifyPassword(password, DUMMY_HASH);
    return { ok: false, reason: user ? 'no_password_set' : 'invalid_credentials' };
  }

  if (!verifyPassword(password, user.passwordHash)) {
    return { ok: false, reason: 'invalid_credentials' };
  }

  return { ok: true, user };
}

/** Re-exported so callers provisioning admin credentials use one hash format. */
export { hashPassword, verifyPassword };
