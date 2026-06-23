import { describe, expect, it } from 'vitest';
import { withdrawals } from '@rivlayx/core';
import { loadEnv } from '../env';
import { withdrawalLimitsFromEnv } from './limits';
import { validateWithdrawalInput } from './request';

const base = { NODE_ENV: 'test', DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };
const VALID_WALLET = 'So11111111111111111111111111111111111111112';

describe('withdrawalLimitsFromEnv — MAX_WITHDRAW_USDC / MAX_DAILY_WITHDRAW_USDC are wired', () => {
  it('defaults to the core WITHDRAWAL_LIMITS source (25 / 100) when absent', () => {
    expect(withdrawalLimitsFromEnv(loadEnv(base))).toEqual({
      maxWithdrawUsdc: '25',
      maxDailyUsdc: '100',
    });
    expect(withdrawals.WITHDRAWAL_LIMITS.maxWithdrawUsdc).toBe('25');
    expect(withdrawals.WITHDRAWAL_LIMITS.maxDailyUsdc).toBe('100');
  });

  it('reflects env overrides', () => {
    expect(
      withdrawalLimitsFromEnv(
        loadEnv({ ...base, MAX_WITHDRAW_USDC: '40', MAX_DAILY_WITHDRAW_USDC: '250' }),
      ),
    ).toEqual({ maxWithdrawUsdc: '40', maxDailyUsdc: '250' });
  });
});

describe('cap source consistency — request, approve and runner agree', () => {
  // request enforces the per-withdrawal cap via validateWithdrawalInput;
  // approve + runner enforce it via core checkWithdrawalAmount. Both must read
  // the same env-resolved limit and reach the same verdict at the boundary.
  it('agree at a custom env cap boundary', () => {
    const limits = withdrawalLimitsFromEnv(loadEnv({ ...base, MAX_WITHDRAW_USDC: '30' }));
    const max = limits.maxWithdrawUsdc;

    const requestVerdict = (amount: string) =>
      validateWithdrawalInput({
        amountUsdc: amount,
        destinationWallet: VALID_WALLET,
        availableUsdc: '1000',
        withdrawalsFrozen: false,
        maxWithdrawUsdc: max,
      });
    const coreVerdict = (amount: string) => withdrawals.checkWithdrawalAmount(amount, max);

    // at the cap: both accept
    expect(requestVerdict('30')).toEqual({ ok: true });
    expect(coreVerdict('30')).toEqual({ ok: true });

    // over the cap: both reject with AMOUNT_EXCEEDS_CAP
    expect(requestVerdict('30.000001')).toMatchObject({ ok: false, code: 'AMOUNT_EXCEEDS_CAP' });
    expect(coreVerdict('30.000001')).toMatchObject({ ok: false, code: 'AMOUNT_EXCEEDS_CAP' });
  });
});
