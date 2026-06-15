import { timingSafeEqual } from 'node:crypto';

export type CronAuthDecision =
  | { ok: true }
  | { ok: false; status: number; code: string; message: string };

export interface CronAuthInput {
  /** Raw value of the incoming `Authorization` header (or null). */
  authHeader: string | null;
  /** Configured secret; undefined/empty when unset. */
  expectedSecret: string | undefined;
  /** True in production — controls the unset-secret fallback. */
  isProduction: boolean;
}

/**
 * Pure cron-auth check, kept independent of Next.js + env loading so it can be
 * unit-tested. Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
 *
 *   - secret configured + matching bearer  → ok
 *   - secret configured + missing/wrong    → 401
 *   - secret unset, non-production         → ok (local-dev convenience)
 *   - secret unset, production             → 503 (refuse rather than run open)
 *
 * Comparison is constant-time to avoid leaking the secret via timing.
 */
export function checkCronAuth(input: CronAuthInput): CronAuthDecision {
  const expected = input.expectedSecret;
  if (!expected) {
    if (!input.isProduction) return { ok: true };
    return { ok: false, status: 503, code: 'CRON_DISABLED', message: 'CRON_SECRET not configured' };
  }
  const header = input.authHeader ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (!token || !timingSafeStrEqual(token, expected)) {
    return { ok: false, status: 401, code: 'UNAUTHORIZED', message: 'invalid or missing cron secret' };
  }
  return { ok: true };
}

export interface HealthAuthInput {
  /** Raw value of the incoming `Authorization` header (or null). */
  authHeader: string | null;
  /** Cron secret (accepted for internal callers); undefined/empty when unset. */
  cronSecret: string | undefined;
  /** Dedicated read-only health token for monitoring vendors; undefined when unset. */
  healthToken: string | undefined;
  /** True in production — controls the all-unset fallback. */
  isProduction: boolean;
}

/**
 * Pure auth for the deep health endpoint (`/api/ops/health`). Accepts EITHER a
 * dedicated `OPS_HEALTH_TOKEN` (so a monitoring vendor never needs the
 * cron-execution secret) OR the cron secret (for internal callers).
 *
 *   - a configured token/secret matches the bearer → ok
 *   - at least one configured, none match          → 401
 *   - neither configured, non-production            → ok (local-dev)
 *   - neither configured, production                → 503 (refuse, don't run open)
 *
 * Constant-time comparison against each configured credential.
 */
export function checkHealthAuth(input: HealthAuthInput): CronAuthDecision {
  const header = input.authHeader ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  const configured = [input.healthToken, input.cronSecret].filter(
    (s): s is string => typeof s === 'string' && s.length > 0,
  );

  if (configured.length === 0) {
    if (!input.isProduction) return { ok: true };
    return {
      ok: false,
      status: 503,
      code: 'HEALTH_DISABLED',
      message: 'no health token or cron secret configured',
    };
  }

  const matches = token.length > 0 && configured.some((secret) => timingSafeStrEqual(token, secret));
  if (!matches) {
    return { ok: false, status: 401, code: 'UNAUTHORIZED', message: 'invalid or missing health credential' };
  }
  return { ok: true };
}

function timingSafeStrEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
