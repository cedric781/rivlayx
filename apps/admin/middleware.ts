import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Reject requests bound for the user subdomain — those must hit `apps/web`.
 * Forces every public hostname to be explicit. In local dev, port 3001 is the
 * admin app and the check is a no-op for `localhost`.
 */
export function middleware(request: NextRequest) {
  const host = (request.headers.get('host') ?? '').toLowerCase();
  if (host.startsWith('app.') || host.startsWith('www.')) {
    return new NextResponse('Wrong host — user app is served from apps/web', { status: 404 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: '/((?!_next/static|_next/image|favicon.ico).*)',
};
