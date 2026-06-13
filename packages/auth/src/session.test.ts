import { describe, expect, it } from 'vitest';
import type { Session } from '@rivlayx/db';
import { defaultLimits, generateSessionId, isIdleExpired } from './session';

describe('session id generation', () => {
  it('produces 64-char hex strings', () => {
    const id = generateSessionId();
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateSessionId()));
    expect(ids.size).toBe(100);
  });
});

describe('default session limits', () => {
  it('user sessions cap at 12h', () => {
    const limits = defaultLimits('user');
    expect(limits.maxMs).toBe(12 * 3_600_000);
    expect(limits.idleMs).toBe(30 * 60_000);
  });

  it('admin sessions cap at 8h with same idle window', () => {
    const limits = defaultLimits('admin');
    expect(limits.maxMs).toBe(8 * 3_600_000);
    expect(limits.idleMs).toBe(30 * 60_000);
  });
});

describe('idle expiration', () => {
  function makeSession(lastActivityAt: Date): Session {
    return {
      id: 'sid',
      userId: 'uid',
      app: 'user',
      ip: null,
      userAgent: null,
      createdAt: new Date(0),
      lastActivityAt,
      expiresAt: new Date(Date.now() + 86_400_000),
      revokedAt: null,
      mfaVerifiedAt: null,
    };
  }

  it('is not expired immediately after activity', () => {
    const session = makeSession(new Date());
    expect(isIdleExpired(session, defaultLimits('user'))).toBe(false);
  });

  it('is expired after idle window elapses', () => {
    const session = makeSession(new Date(Date.now() - 31 * 60_000));
    expect(isIdleExpired(session, defaultLimits('user'))).toBe(true);
  });

  it('treats edge exactly at idle window as expired', () => {
    const session = makeSession(new Date(Date.now() - 30 * 60_000));
    expect(isIdleExpired(session, defaultLimits('user'))).toBe(true);
  });
});
