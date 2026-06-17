import { describe, expect, it } from 'vitest';
import { validateWithdrawalInput } from './request';

// Canonical wrapped-SOL mint — a known-valid base58 Solana address.
const VALID_WALLET = 'So11111111111111111111111111111111111111112';
const base = {
  amountUsdc: '10',
  destinationWallet: VALID_WALLET,
  availableUsdc: '100',
  withdrawalsFrozen: false,
};

describe('validateWithdrawalInput', () => {
  it('accepts a well-formed request within balance', () => {
    expect(validateWithdrawalInput(base)).toEqual({ ok: true });
  });

  it('blocks first when withdrawals are frozen, before any other check', () => {
    const r = validateWithdrawalInput({
      ...base,
      withdrawalsFrozen: true,
      amountUsdc: '999999', // would also be insufficient, but freeze wins
    });
    expect(r).toMatchObject({ ok: false, code: 'FROZEN' });
  });

  it('rejects malformed amounts', () => {
    for (const amt of ['0', '-5', 'abc', '1.1234567', '']) {
      expect(validateWithdrawalInput({ ...base, amountUsdc: amt })).toMatchObject({
        ok: false,
        code: 'INVALID_INPUT',
      });
    }
  });

  it('rejects an invalid destination wallet', () => {
    expect(validateWithdrawalInput({ ...base, destinationWallet: 'not-an-address' })).toMatchObject({
      ok: false,
      code: 'INVALID_INPUT',
    });
  });

  it('rejects an amount above the per-withdrawal cap (25)', () => {
    for (const amt of ['25.000001', '26', '100']) {
      expect(
        validateWithdrawalInput({ ...base, amountUsdc: amt, availableUsdc: '1000' }),
      ).toMatchObject({ ok: false, code: 'AMOUNT_EXCEEDS_CAP' });
    }
  });

  it('accepts an amount exactly at the cap', () => {
    expect(validateWithdrawalInput({ ...base, amountUsdc: '25', availableUsdc: '25' })).toEqual({
      ok: true,
    });
  });

  it('checks the cap before the balance (over cap but within balance still fails on cap)', () => {
    expect(
      validateWithdrawalInput({ ...base, amountUsdc: '50', availableUsdc: '1000' }),
    ).toMatchObject({ ok: false, code: 'AMOUNT_EXCEEDS_CAP' });
  });

  it('rejects an amount above available balance (within the cap)', () => {
    expect(
      validateWithdrawalInput({ ...base, amountUsdc: '20', availableUsdc: '5' }),
    ).toMatchObject({ ok: false, code: 'INSUFFICIENT_BALANCE' });
  });

  it('allows withdrawing the full available balance (within the cap)', () => {
    expect(validateWithdrawalInput({ ...base, amountUsdc: '20', availableUsdc: '20' })).toEqual({
      ok: true,
    });
  });
});
