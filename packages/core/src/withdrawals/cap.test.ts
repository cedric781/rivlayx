import { describe, expect, it } from 'vitest';
import {
  WITHDRAWAL_LIMITS,
  checkDailyCap,
  checkWithdrawalAmount,
  nextWithdrawalBackoffMs,
} from './cap';

describe('checkWithdrawalAmount', () => {
  it('accepts amounts up to the per-withdrawal cap', () => {
    expect(checkWithdrawalAmount('25')).toEqual({ ok: true });
    expect(checkWithdrawalAmount('0.000001')).toEqual({ ok: true });
  });
  it('rejects non-positive amounts', () => {
    expect(checkWithdrawalAmount('0')).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
    expect(checkWithdrawalAmount('-1')).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
  });
  it('rejects amounts over MAX_WITHDRAW_USDC (25)', () => {
    expect(WITHDRAWAL_LIMITS.maxWithdrawUsdc).toBe('25');
    expect(checkWithdrawalAmount('25.000001')).toMatchObject({
      ok: false,
      code: 'AMOUNT_EXCEEDS_CAP',
    });
  });
});

describe('checkDailyCap', () => {
  it('allows when prior + amount is within the daily cap', () => {
    expect(checkDailyCap('80', '20')).toEqual({ ok: true });
  });
  it('rejects when prior + amount exceeds the daily cap (100)', () => {
    expect(WITHDRAWAL_LIMITS.maxDailyUsdc).toBe('100');
    expect(checkDailyCap('80', '25')).toMatchObject({ ok: false, code: 'DAILY_CAP_EXCEEDED' });
  });
});

describe('nextWithdrawalBackoffMs', () => {
  it('follows the schedule and clamps to the last value', () => {
    expect(nextWithdrawalBackoffMs(1)).toBe(WITHDRAWAL_LIMITS.retryBackoffsMs[0]);
    expect(nextWithdrawalBackoffMs(99)).toBe(
      WITHDRAWAL_LIMITS.retryBackoffsMs[WITHDRAWAL_LIMITS.retryBackoffsMs.length - 1],
    );
  });
});
