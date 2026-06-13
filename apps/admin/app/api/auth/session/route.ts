import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { COOKIE_NAMES, defaultLimits, isIdleExpired, loadActiveSession } from '@rivlayx/auth';
import { userRoles, users } from '@rivlayx/db';
import { getDb } from '@/lib/db';

export async function GET() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(COOKIE_NAMES.admin)?.value;
  if (!sessionId) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const db = getDb();
  const session = await loadActiveSession(db, sessionId);
  if (!session || session.app !== 'admin' || isIdleExpired(session, defaultLimits('admin'))) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (!user || user.status !== 'active') {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const rolesRows = await db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.userId, user.id));

  return NextResponse.json({
    authenticated: true,
    user: { id: user.id, email: user.email, displayName: user.displayName },
    roles: rolesRows.map((r) => r.role),
    mfaVerifiedAt: session.mfaVerifiedAt,
  });
}
