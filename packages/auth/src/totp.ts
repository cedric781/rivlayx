import { timingSafeEqual } from 'node:crypto';
import { authenticator } from 'otplib';

/**
 * RFC-6238 TOTP (C5). Thin wrapper over `otplib` that injects time, enforces a
 * ±1 step verification window, returns the absolute step that matched (for the
 * replay guard), and compares tokens in constant time.
 */

export const TOTP_STEP_SECONDS = 30;
/** Accept the current step plus one on either side (clock skew tolerance). */
export const TOTP_WINDOW = 1;
const TOKEN_RE = /^[0-9]{6}$/;

export interface TotpVerifyResult {
  ok: boolean;
  /** Absolute TOTP step that matched (epoch-seconds / step). Null on failure. */
  step: number | null;
}

/** Generate a fresh base32 TOTP secret for enrollment. */
export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

/** Build the `otpauth://` provisioning URI rendered as the enrollment QR code. */
export function totpKeyUri(secret: string, accountName: string, issuer: string): string {
  return authenticator.keyuri(accountName, issuer, secret);
}

/** The TOTP token expected at a given absolute step. */
function tokenForStep(secret: string, step: number): string {
  const epochMs = step * TOTP_STEP_SECONDS * 1000;
  return authenticator.clone({ step: TOTP_STEP_SECONDS, epoch: epochMs }).generate(secret);
}

/** Constant-time equality over equal-length 6-digit token strings. */
function tokensEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Verify `token` against `secret` at time `now`, scanning steps in the ±1
 * window. Returns the matched absolute step so the caller can reject replays.
 */
export function verifyTotp(secret: string, token: string, now: Date): TotpVerifyResult {
  if (!TOKEN_RE.test(token)) return { ok: false, step: null };
  const baseStep = Math.floor(now.getTime() / 1000 / TOTP_STEP_SECONDS);
  for (let delta = -TOTP_WINDOW; delta <= TOTP_WINDOW; delta += 1) {
    const step = baseStep + delta;
    if (tokensEqual(token, tokenForStep(secret, step))) {
      return { ok: true, step };
    }
  }
  return { ok: false, step: null };
}
