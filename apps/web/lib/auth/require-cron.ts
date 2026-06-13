import { NextResponse } from 'next/server';
import { cron } from '@rivlayx/core';
import { getEnv } from '@/lib/env';

export type CronAuthResult = { ok: true } | { ok: false; response: NextResponse };

/**
 * Cron-route auth. Wraps the pure `cron.checkCronAuth` with env + Next.js
 * response building. Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
 */
export function requireCron(request: Request): CronAuthResult {
  const env = getEnv();
  const decision = cron.checkCronAuth({
    authHeader: request.headers.get('authorization'),
    expectedSecret: env.CRON_SECRET,
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
