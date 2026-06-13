import type { ReactNode } from 'react';
import { requireSession } from '@rivlayx/auth/next';
import { getDb } from '@/lib/db';

/**
 * Post-login layout: session required, role gate enforced, but MFA NOT required.
 * Hosts the /mfa flow so the user can complete the second factor.
 */
export default async function PostLoginLayout({ children }: { children: ReactNode }) {
  await requireSession(getDb, {
    app: 'admin',
    minRole: 'moderator',
    requireMfa: false,
    loginPath: '/login',
  });
  return <>{children}</>;
}
