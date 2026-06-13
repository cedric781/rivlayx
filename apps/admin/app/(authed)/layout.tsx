import type { ReactNode } from 'react';
import { requireSession } from '@rivlayx/auth/next';
import { getDb } from '@/lib/db';

/**
 * Privileged layout: session required, role gate enforced, MFA verified.
 * `requireMfa` defaults to auto — for admin app this means MFA is required when
 * any granted role is admin/super_admin (see `mfaRequiredRoles`).
 */
export default async function AuthedLayout({ children }: { children: ReactNode }) {
  await requireSession(getDb, {
    app: 'admin',
    minRole: 'moderator',
    loginPath: '/login',
    mfaPath: '/mfa',
  });
  return <>{children}</>;
}
