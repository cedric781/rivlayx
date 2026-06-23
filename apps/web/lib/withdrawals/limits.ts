import type { withdrawals } from '@rivlayx/core';
import { type Env, getEnv } from '../env';

/**
 * Resolve the typed withdrawal caps from env. Pure (no process.env read) so it
 * is unit-testable. This is the single web→core boundary that turns the
 * `MAX_WITHDRAW_USDC` / `MAX_DAILY_WITHDRAW_USDC` env into the `WithdrawalLimits`
 * that request, approve and runner all enforce.
 */
export function withdrawalLimitsFromEnv(env: Env): withdrawals.WithdrawalLimits {
  return {
    maxWithdrawUsdc: String(env.MAX_WITHDRAW_USDC),
    maxDailyUsdc: String(env.MAX_DAILY_WITHDRAW_USDC),
  };
}

/** Live withdrawal caps from the process env. */
export function getWithdrawalLimits(): withdrawals.WithdrawalLimits {
  return withdrawalLimitsFromEnv(getEnv());
}
