import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { COOKIE_NAMES, defaultLimits, isIdleExpired, loadActiveSession } from '@rivlayx/auth';
import { userRoles, users, wallets } from '@rivlayx/db';
import { getDb } from '@/lib/db';

export async function GET() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(COOKIE_NAMES.user)?.value;
  if (!sessionId) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const db = getDb();
  const session = await loadActiveSession(db, sessionId);
  if (!session || session.app !== 'user' || isIdleExpired(session, defaultLimits('user'))) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (!user || user.status !== 'active') {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const [wallet] = await db.select().from(wallets).where(eq(wallets.userId, user.id)).limit(1);
  const rolesRows = await db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.userId, user.id));

  return NextResponse.json({
    authenticated: true,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
    },
    wallet: wallet ? { address: wallet.address, chain: wallet.chain, source: wallet.source } : null,
    roles: rolesRows.map((r) => r.role),
  });
}
