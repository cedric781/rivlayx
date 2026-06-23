import { bets } from '@rivlayx/core';
import { type Env, getEnv } from '../env';

/**
 * Resolve the bet-engine config from env. Pure (no process.env read) so it is
 * unit-testable. Only `maxBetUsdc` is env-backed today; the rest keep the core
 * `BET_ENGINE_DEFAULTS`. This is the single web→core boundary that makes the
 * `MAX_BET_USDC` env actually drive the create-bet stake cap.
 */
export function betEngineConfigFromEnv(env: Env): bets.BetEngineConfig {
  return {
    ...bets.BET_ENGINE_DEFAULTS,
    maxBetUsdc: String(env.MAX_BET_USDC),
  };
}

/** Live bet-engine config from the process env. */
export function getBetEngineConfig(): bets.BetEngineConfig {
  return betEngineConfigFromEnv(getEnv());
}
