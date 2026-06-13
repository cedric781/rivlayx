import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE_NAMES, revokeSession } from '@rivlayx/auth';
import { getDb } from '@/lib/db';

export async function POST() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(COOKIE_NAMES.user)?.value;
  if (sessionId) {
    await revokeSession(getDb(), sessionId);
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(COOKIE_NAMES.user);
  return res;
}
