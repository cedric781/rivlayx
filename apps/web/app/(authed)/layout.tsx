import type { ReactNode } from 'react';
import { requireSession } from '@rivlayx/auth/next';
import { getDb } from '@/lib/db';

export default async function AuthedLayout({ children }: { children: ReactNode }) {
  await requireSession(getDb, { app: 'user', loginPath: '/login' });
  return <>{children}</>;
}
