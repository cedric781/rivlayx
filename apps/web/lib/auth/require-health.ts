import { NextResponse } from 'next/server';
import { cron } from '@rivlayx/core';
import { getEnv } from '@/lib/env';
import type { CronAuthResult } from './require-cron';

/**
 * Deep-health-endpoint auth (Sprint 24 G4). Accepts EITHER the dedicated
 * `OPS_HEALTH_TOKEN` (for monitoring vendors — never share `CRON_SECRET`) OR the
 * cron secret (internal callers). Wraps the pure `cron.checkHealthAuth`.
 */
export function requireHealth(request: Request): CronAuthResult {
  const env = getEnv();
  const decision = cron.checkHealthAuth({
    authHeader: request.headers.get('authorization'),
    cronSecret: env.CRON_SECRET,
    healthToken: env.OPS_HEALTH_TOKEN,
    isProduction: env.NODE_ENV === 'production',
  });
  if (decision.ok) return { ok: true };
  return {
    ok: false,
    response: NextResponse.json(
      { error: { code: decision.code, message: decision.message } },
      { status: decision.status },
    ),
  };
}
