import { describe, expect, it } from 'vitest';
import { authenticator } from 'otplib';
import { TOTP_STEP_SECONDS, generateTotpSecret, totpKeyUri, verifyTotp } from './totp';

const secret = generateTotpSecret();
const now = new Date('2026-06-23T12:00:00Z');

/** Reference token the library would emit at a given instant. */
function tokenAt(date: Date): string {
  return authenticator.clone({ step: TOTP_STEP_SECONDS, epoch: date.getTime() }).generate(secret);
}

const expectedStep = Math.floor(now.getTime() / 1000 / TOTP_STEP_SECONDS);

describe('verifyTotp', () => {
  it('accepts a valid current-step token and returns its absolute step', () => {
    const result = verifyTotp(secret, tokenAt(now), now);
    expect(result.ok).toBe(true);
    expect(result.step).toBe(expectedStep);
  });

  it('accepts a token from one step ago (±1 window)', () => {
    const prev = new Date(now.getTime() - TOTP_STEP_SECONDS * 1000);
    const result = verifyTotp(secret, tokenAt(prev), now);
    expect(result.ok).toBe(true);
    expect(result.step).toBe(expectedStep - 1);
  });

  it('rejects an incorrect code', () => {
    const windowTokens = new Set([
      tokenAt(new Date(now.getTime() - TOTP_STEP_SECONDS * 1000)),
      tokenAt(now),
      tokenAt(new Date(now.getTime() + TOTP_STEP_SECONDS * 1000)),
    ]);
    const wrong = ['000000', '111111', '123456', '654321'].find((c) => !windowTokens.has(c))!;
    expect(verifyTotp(secret, wrong, now).ok).toBe(false);
  });

  it('rejects a token from outside the ±1 window (expired)', () => {
    const stale = new Date(now.getTime() - 5 * TOTP_STEP_SECONDS * 1000);
    expect(verifyTotp(secret, tokenAt(stale), now).ok).toBe(false);
  });

  it('rejects malformed input', () => {
    expect(verifyTotp(secret, 'abc', now).ok).toBe(false);
    expect(verifyTotp(secret, '12345', now).ok).toBe(false);
  });

  it('advances the step for a later code (replay-guard input)', () => {
    const next = new Date(now.getTime() + TOTP_STEP_SECONDS * 1000);
    expect(verifyTotp(secret, tokenAt(next), now).step).toBe(expectedStep + 1);
  });
});

describe('totpKeyUri', () => {
  it('builds an otpauth URI with issuer + account', () => {
    const uri = totpKeyUri(secret, 'admin@rivlayx.com', 'RivlayX Admin');
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain('RivlayX%20Admin');
    expect(uri).toContain('admin%40rivlayx.com');
  });
});
