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

function timingSafeStrEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
