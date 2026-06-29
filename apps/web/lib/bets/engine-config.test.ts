import { describe, expect, it } from 'vitest';
import { bets, withdrawals } from '@rivlayx/core';
import { loadEnv } from '../env';
import { betEngineConfigFromEnv } from './engine-config';

const base = { NODE_ENV: 'test', DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };

// The engine allows a stake when `stake <= maxBet` (create.ts: stake.gt(maxBet)
// rejects). `coversAmount(cap, stake)` is the same Decimal-exact `cap >= stake`
// comparison — reused here so the test does no JS-float money math.
const allows = (cfg: bets.BetEngineConfig, stake: string) =>
  withdrawals.coversAmount(cfg.maxBetUsdc, stake);

describe('betEngineConfigFromEnv — MAX_BET_USDC is actually wired', () => {
  it('defaults to 25 when MAX_BET_USDC is absent (test/dev)', () => {
    const cfg = betEngineConfigFromEnv(loadEnv(base));
    expect(cfg.maxBetUsdc).toBe('25');
    // keeps the rest of the core defaults untouched
    expect(cfg.defaultCreationFeeUsdc).toBe(bets.BET_ENGINE_DEFAULTS.defaultCreationFeeUsdc);
  });

  it('MAX_BET_USDC=50 lets a stake of 40 through and rejects above the cap', () => {
    const cfg = betEngineConfigFromEnv(loadEnv({ ...base, MAX_BET_USDC: '50' }));
    expect(cfg.maxBetUsdc).toBe('50');
    expect(allows(cfg, '40')).toBe(true);
    expect(allows(cfg, '50')).toBe(true);
    expect(allows(cfg, '50.000001')).toBe(false);
    expect(allows(cfg, '60')).toBe(false);
  });

  it('at the default cap a stake of 40 is rejected (proves the env value is in force)', () => {
    const cfg = betEngineConfigFromEnv(loadEnv(base));
    expect(allows(cfg, '40')).toBe(false);
  });
});
