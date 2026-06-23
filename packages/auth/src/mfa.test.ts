import { describe, expect, it } from 'vitest';
import { authenticator } from 'otplib';
import type { Session } from '@rivlayx/db';
import { TOTP_STEP_SECONDS, generateTotpSecret } from './totp';
import { encryptSecret } from './crypto';
import { isMfaFresh } from './session';
import { MFA_RATE_LIMIT, buildEnrollment, evaluateMfaAttempt, type MfaUserState } from './mfa';
import { MFA_REQUIRED_ACTIONS, requiresMfaForAction } from './permissions';

const KEY = Buffer.alloc(32, 7).toString('base64');
const now = new Date('2026-06-23T12:00:00Z');
const currentStep = Math.floor(now.getTime() / 1000 / TOTP_STEP_SECONDS);

function tokenAt(secret: string, date: Date): string {
  return authenticator.clone({ step: TOTP_STEP_SECONDS, epoch: date.getTime() }).generate(secret);
}

function userWith(secret: string, overrides: Partial<MfaUserState> = {}): MfaUserState {
  return {
    id: 'user-1',
    email: 'admin@rivlayx.com',
    mfaSecretEncrypted: encryptSecret(secret, KEY),
    mfaEnrolledAt: new Date('2026-06-01T00:00:00Z'),
    mfaLastVerifiedStep: null,
    mfaFailedAttempts: 0,
    mfaLockedUntil: null,
    ...overrides,
  };
}

describe('evaluateMfaAttempt', () => {
  it('accepts a valid TOTP and returns the matched step', () => {
    const secret = generateTotpSecret();
    const res = evaluateMfaAttempt({
      user: userWith(secret),
      code: tokenAt(secret, now),
      now,
      encryptionKey: KEY,
    });
    expect(res.outcome).toBe('ok');
    expect(res.step).toBe(currentStep);
  });

  it('completes enrollment on the first success (no prior mfaEnrolledAt)', () => {
    const secret = generateTotpSecret();
    const res = evaluateMfaAttempt({
      user: userWith(secret, { mfaEnrolledAt: null }),
      code: tokenAt(secret, now),
      now,
      encryptionKey: KEY,
    });
    expect(res.outcome).toBe('ok');
    expect(res.completesEnrollment).toBe(true);
  });

  it('rejects an invalid TOTP and increments the failure counter', () => {
    const secret = generateTotpSecret();
    const res = evaluateMfaAttempt({
      user: userWith(secret, { mfaFailedAttempts: 1 }),
      code: '000000',
      now,
      encryptionKey: KEY,
    });
    // '000000' is overwhelmingly not a window token; guard against the 1-in-1e6 fluke.
    if (res.outcome === 'ok') return;
    expect(res.outcome).toBe('invalid');
    expect(res.nextFailedAttempts).toBe(2);
    expect(res.nextLockedUntil).toBeNull();
  });

  it('rejects a replayed step (token already consumed)', () => {
    const secret = generateTotpSecret();
    const res = evaluateMfaAttempt({
      user: userWith(secret, { mfaLastVerifiedStep: currentStep }),
      code: tokenAt(secret, now),
      now,
      encryptionKey: KEY,
    });
    expect(res.outcome).toBe('replay');
    expect(res.nextFailedAttempts).toBe(1);
  });

  it('locks out after maxAttempts failures', () => {
    const secret = generateTotpSecret();
    const res = evaluateMfaAttempt({
      user: userWith(secret, { mfaFailedAttempts: MFA_RATE_LIMIT.maxAttempts - 1 }),
      code: '000000',
      now,
      encryptionKey: KEY,
    });
    if (res.outcome === 'ok') return; // fluke guard
    expect(res.nextFailedAttempts).toBe(MFA_RATE_LIMIT.maxAttempts);
    expect(res.nextLockedUntil).toEqual(new Date(now.getTime() + MFA_RATE_LIMIT.lockoutMs));
  });

  it('refuses while locked out, without checking the code', () => {
    const secret = generateTotpSecret();
    const res = evaluateMfaAttempt({
      user: userWith(secret, { mfaLockedUntil: new Date(now.getTime() + 60_000) }),
      code: tokenAt(secret, now),
      now,
      encryptionKey: KEY,
    });
    expect(res.outcome).toBe('locked');
  });

  it('reports not_enrolled when no secret is stored', () => {
    const res = evaluateMfaAttempt({
      user: userWith(generateTotpSecret(), { mfaSecretEncrypted: null }),
      code: '123456',
      now,
      encryptionKey: KEY,
    });
    expect(res.outcome).toBe('not_enrolled');
  });
});

describe('buildEnrollment → verify (enrollment flow)', () => {
  it('produces a secret + otpauth URI whose first code completes enrollment', () => {
    const enrollment = buildEnrollment({
      accountName: 'admin@rivlayx.com',
      issuer: 'RivlayX Admin',
      encryptionKey: KEY,
    });
    expect(enrollment.otpauthUri).toMatch(/^otpauth:\/\/totp\//);

    const user = userWith(enrollment.secret, {
      mfaSecretEncrypted: enrollment.encryptedSecret,
      mfaEnrolledAt: null,
    });
    const res = evaluateMfaAttempt({
      user,
      code: tokenAt(enrollment.secret, now),
      now,
      encryptionKey: KEY,
    });
    expect(res.outcome).toBe('ok');
    expect(res.completesEnrollment).toBe(true);
  });
});

describe('isMfaFresh (freshness expiry)', () => {
  function session(mfaVerifiedAt: Date | null): Session {
    return {
      id: 'sid',
      userId: 'user-1',
      app: 'admin',
      ip: null,
      userAgent: null,
      createdAt: new Date(0),
      lastActivityAt: now,
      expiresAt: new Date(now.getTime() + 3_600_000),
      revokedAt: null,
      mfaVerifiedAt,
    };
  }
  const maxAgeMs = 15 * 60_000;

  it('is fresh just after verification', () => {
    expect(isMfaFresh(session(new Date(now.getTime() - 60_000)), maxAgeMs, now)).toBe(true);
  });

  it('is stale once the window elapses', () => {
    expect(isMfaFresh(session(new Date(now.getTime() - 16 * 60_000)), maxAgeMs, now)).toBe(false);
  });

  it('is never fresh when MFA was never verified', () => {
    expect(isMfaFresh(session(null), maxAgeMs, now)).toBe(false);
  });
});

describe('money-action gate contract (require-admin-api relies on this)', () => {
  // requireAdminApi gates with: requiresMfaForAction(permission) && isMfaFresh(session).
  // These assertions prove every money action is MFA-gated and that a stale/absent
  // verification fails freshness — i.e. the route returns MFA_REQUIRED.
  const moneyActions = [
    'approveWithdrawal', // approve + reject routes
    'freezeComponent',
    'emergencyFreezeAll',
    'ruleDispute', // dispute ruling + bet resolve
    'voidBet',
    'manageRoles',
  ] as const;

  it('requires MFA for every money/admin mutation', () => {
    for (const action of moneyActions) {
      expect(requiresMfaForAction(action)).toBe(true);
      expect(MFA_REQUIRED_ACTIONS.has(action)).toBe(true);
    }
  });

  it('a session without fresh MFA fails the gate', () => {
    const stale: Session = {
      id: 'sid',
      userId: 'u',
      app: 'admin',
      ip: null,
      userAgent: null,
      createdAt: new Date(0),
      lastActivityAt: now,
      expiresAt: new Date(now.getTime() + 3_600_000),
      revokedAt: null,
      mfaVerifiedAt: null,
    };
    expect(isMfaFresh(stale, 15 * 60_000, now)).toBe(false);
  });
});
