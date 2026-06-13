import type { SessionApp } from '@rivlayx/db';

/**
 * Per-app cookie name. Distinct names prevent cross-contamination between the
 * user app (`app.rivlayx.com`) and admin app (`admin.rivlayx.com`) even when
 * the browser shares a parent domain.
 */
export const COOKIE_NAMES: Record<SessionApp, string> = {
  user: 'rivlayx_user_session',
  admin: 'rivlayx_admin_session',
};

export interface CookieAttributes {
  name: string;
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge: number;
}

export function buildCookieAttributes(
  app: SessionApp,
  options: { secure: boolean; maxAgeSeconds: number },
): CookieAttributes {
  return {
    name: COOKIE_NAMES[app],
    httpOnly: true,
    secure: options.secure,
    sameSite: 'lax',
    path: '/',
    maxAge: options.maxAgeSeconds,
  };
}
