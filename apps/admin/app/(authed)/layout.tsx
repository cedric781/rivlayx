import type { ReactNode } from 'react';
import { requireSession } from '@rivlayx/auth/next';
import { getDb } from '@/lib/db';
import { getEnv } from '@/lib/env';

/**
 * Privileged layout: session required, role gate enforced, MFA verified.
 * `requireMfa` defaults to auto — for admin app this means MFA is required when
 * any granted role is admin/super_admin (see `mfaRequiredRoles`). C5: MFA must
 * also be *fresh* (verified within `MFA_MAX_AGE_MINUTES`), so a stale session is
 * bounced back to `/mfa` before reaching any privileged page.
 */
export default async function AuthedLayout({ children }: { children: ReactNode }) {
  await requireSession(getDb, {
    app: 'admin',
    minRole: 'moderator',
    mfaMaxAgeMs: getEnv().MFA_MAX_AGE_MINUTES * 60_000,
    loginPath: '/login',
    mfaPath: '/mfa',
  });
  return <>{children}</>;
}
