import { describe, expect, it } from 'vitest';
import {
  WITHDRAWAL_LIMITS,
  checkDailyCap,
  checkWithdrawalAmount,
  coversAmount,
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

describe('coversAmount — Decimal-exact balance coverage', () => {
  it('treats exact-equal balance as covering (6-decimal boundary)', () => {
    expect(coversAmount('25.000000', '25.000000')).toBe(true);
    expect(coversAmount('10.000001', '10.000000')).toBe(true);
  });
  it('rejects a balance short by a single micro-USDC (6th decimal)', () => {
    expect(coversAmount('24.999999', '25.000000')).toBe(false);
    expect(coversAmount('10.000000', '10.000001')).toBe(false);
  });
  it('is exact where JS float comparison silently fails', () => {
    // Number('9007199254740993') === 9007199254740992 (loses the last digit),
    // so a float compare would call this "covered" — Decimal must not.
    expect(coversAmount('9007199254740992', '9007199254740993')).toBe(false);
    // 0.1 + 0.2 === 0.30000000000000004 in float, which is strictly > 0.3.
    // Decimal keeps the ordering exact: 0.3 does not cover it, but it covers 0.3.
    expect(coversAmount('0.3', '0.30000000000000004')).toBe(false);
    expect(coversAmount('0.30000000000000004', '0.3')).toBe(true);
  });
  it('defaults a blank balance to zero', () => {
    expect(coversAmount('', '0.000001')).toBe(false);
    expect(coversAmount('', '0')).toBe(true);
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
