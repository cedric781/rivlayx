import { eq } from 'drizzle-orm';
import { sessions, users } from '@rivlayx/db';
import type { AuthDb } from './session';
import { decryptSecret, encryptSecret } from './crypto';
import { generateTotpSecret, totpKeyUri, verifyTotp } from './totp';

/**
 * C5 — TOTP MFA orchestration. The hard logic (`evaluateMfaAttempt`) is pure:
 * given the user's MFA columns + a code + the clock, it returns a decision plus
 * the next persisted state, so rate limiting and replay protection are fully
 * unit-testable without a DB. The thin DB helpers apply that decision.
 */

/** Per-deployment rate-limit policy. Code constants — not env-tunable. */
export const MFA_RATE_LIMIT = {
  /** Failed attempts (inclusive) that trigger a lockout. */
  maxAttempts: 5,
  /** Lockout duration once `maxAttempts` is reached. */
  lockoutMs: 15 * 60_000,
} as const;

/** The MFA-relevant columns of an `auth.users` row. */
export interface MfaUserState {
  id: string;
  email: string;
  mfaSecretEncrypted: string | null;
  mfaEnrolledAt: Date | null;
  mfaLastVerifiedStep: number | null;
  mfaFailedAttempts: number;
  mfaLockedUntil: Date | null;
}

export type MfaAttemptOutcome = 'ok' | 'invalid' | 'replay' | 'locked' | 'not_enrolled' | 'error';

export interface MfaAttemptResult {
  outcome: MfaAttemptOutcome;
  /** Matched step to persist (replay guard). Present only when outcome==='ok'. */
  step?: number;
  /** Failed-attempt counter to persist. Present for invalid/replay. */
  nextFailedAttempts?: number;
  /** Lockout deadline to persist, when this attempt triggered one. */
  nextLockedUntil?: Date | null;
  /** When the caller should treat this as enrollment completion. */
  completesEnrollment?: boolean;
}

export interface EvaluateMfaAttemptInput {
  user: MfaUserState;
  code: string;
  now: Date;
  encryptionKey: string;
  rateLimit?: { maxAttempts: number; lockoutMs: number };
}

/**
 * Pure decision for a single TOTP attempt. Does NOT touch the DB — returns the
 * outcome and the next counters/lockout the caller must persist.
 */
export function evaluateMfaAttempt(input: EvaluateMfaAttemptInput): MfaAttemptResult {
  const { user, code, now, encryptionKey } = input;
  const policy = input.rateLimit ?? MFA_RATE_LIMIT;

  if (user.mfaLockedUntil && user.mfaLockedUntil.getTime() > now.getTime()) {
    return { outcome: 'locked', nextLockedUntil: user.mfaLockedUntil };
  }
  if (!user.mfaSecretEncrypted) {
    return { outcome: 'not_enrolled' };
  }

  let secret: string;
  try {
    secret = decryptSecret(user.mfaSecretEncrypted, encryptionKey);
  } catch {
    return { outcome: 'error' };
  }

  const verify = verifyTotp(secret, code, now);
  const isReplay = verify.ok && user.mfaLastVerifiedStep != null && verify.step! <= user.mfaLastVerifiedStep;

  if (!verify.ok || isReplay) {
    const nextFailedAttempts = user.mfaFailedAttempts + 1;
    const locked = nextFailedAttempts >= policy.maxAttempts;
    return {
      outcome: isReplay ? 'replay' : 'invalid',
      nextFailedAttempts,
      nextLockedUntil: locked ? new Date(now.getTime() + policy.lockoutMs) : null,
    };
  }

  return {
    outcome: 'ok',
    step: verify.step!,
    completesEnrollment: user.mfaEnrolledAt == null,
  };
}

export interface EnrollmentMaterial {
  secret: string;
  encryptedSecret: string;
  otpauthUri: string;
}

/** Generate a fresh secret + provisioning URI for enrollment (pure). */
export function buildEnrollment(input: {
  accountName: string;
  issuer: string;
  encryptionKey: string;
}): EnrollmentMaterial {
  const secret = generateTotpSecret();
  return {
    secret,
    encryptedSecret: encryptSecret(secret, input.encryptionKey),
    otpauthUri: totpKeyUri(secret, input.accountName, input.issuer),
  };
}

// ── DB helpers (apply the pure decisions) ──────────────────────────────────

/** Load the MFA columns for a user. */
export async function loadMfaUserState(db: AuthDb, userId: string): Promise<MfaUserState | null> {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      mfaSecretEncrypted: users.mfaSecretEncrypted,
      mfaEnrolledAt: users.mfaEnrolledAt,
      mfaLastVerifiedStep: users.mfaLastVerifiedStep,
      mfaFailedAttempts: users.mfaFailedAttempts,
      mfaLockedUntil: users.mfaLockedUntil,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

/**
 * Persist a freshly generated (not-yet-confirmed) secret. Resets the replay
 * step + lockout counters so a re-enrollment starts clean.
 */
export async function storePendingMfaSecret(
  db: AuthDb,
  userId: string,
  encryptedSecret: string,
): Promise<void> {
  await db
    .update(users)
    .set({
      mfaSecretEncrypted: encryptedSecret,
      mfaEnrolledAt: null,
      mfaLastVerifiedStep: null,
      mfaFailedAttempts: 0,
      mfaLockedUntil: null,
    })
    .where(eq(users.id, userId));
}

/**
 * Apply a successful verification: advance the replay step, clear the failure
 * counters, mark the session MFA-verified now, and (on first success) complete
 * enrollment.
 */
export async function applyMfaSuccess(
  db: AuthDb,
  input: { userId: string; sessionId: string; step: number; completesEnrollment: boolean; now: Date },
): Promise<void> {
  await db
    .update(users)
    .set({
      mfaLastVerifiedStep: input.step,
      mfaFailedAttempts: 0,
      mfaLockedUntil: null,
      ...(input.completesEnrollment ? { mfaEnrolledAt: input.now } : {}),
    })
    .where(eq(users.id, input.userId));
  await db
    .update(sessions)
    .set({ mfaVerifiedAt: input.now })
    .where(eq(sessions.id, input.sessionId));
}

/** Apply a failed/replayed attempt: persist the new counter + any lockout. */
export async function applyMfaFailure(
  db: AuthDb,
  input: { userId: string; failedAttempts: number; lockedUntil: Date | null },
): Promise<void> {
  await db
    .update(users)
    .set({ mfaFailedAttempts: input.failedAttempts, mfaLockedUntil: input.lockedUntil })
    .where(eq(users.id, input.userId));
}
