import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Reject requests bound for the admin subdomain — those must hit `apps/admin`.
 * In local dev, hosts are typically `localhost:3000` (user) or `localhost:3001`
 * (admin) so the check is a no-op there.
 */
export function middleware(request: NextRequest) {
  const host = (request.headers.get('host') ?? '').toLowerCase();
  if (host.startsWith('admin.')) {
    return new NextResponse('Wrong host — admin app is served from apps/admin', { status: 404 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: '/((?!_next/static|_next/image|favicon.ico).*)',
};
