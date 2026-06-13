import { describe, expect, it } from 'vitest';
import { buildCookieAttributes, COOKIE_NAMES } from './cookies';

describe('cookie names', () => {
  it('uses distinct names per app to prevent cross-contamination', () => {
    expect(COOKIE_NAMES.user).toBe('rivlayx_user_session');
    expect(COOKIE_NAMES.admin).toBe('rivlayx_admin_session');
    expect(COOKIE_NAMES.user).not.toBe(COOKIE_NAMES.admin);
  });
});

describe('cookie attributes', () => {
  it('builds secure attributes for production', () => {
    const attrs = buildCookieAttributes('user', { secure: true, maxAgeSeconds: 3600 });
    expect(attrs).toEqual({
      name: 'rivlayx_user_session',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 3600,
    });
  });

  it('builds non-secure attributes for local dev', () => {
    const attrs = buildCookieAttributes('admin', { secure: false, maxAgeSeconds: 1800 });
    expect(attrs.secure).toBe(false);
    expect(attrs.name).toBe('rivlayx_admin_session');
    expect(attrs.maxAge).toBe(1800);
  });

  it('always sets HttpOnly and SameSite=Lax', () => {
    const attrs = buildCookieAttributes('user', { secure: false, maxAgeSeconds: 60 });
    expect(attrs.httpOnly).toBe(true);
    expect(attrs.sameSite).toBe('lax');
  });
});
