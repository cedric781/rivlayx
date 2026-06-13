import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { computeBalanceDeltas, LOCKED_ACCOUNT_TYPES } from './accounting';
import type { LedgerEntryInput } from './types';

const userA = randomUUID();
const userB = randomUUID();
const betId = randomUUID();

describe('LOCKED_ACCOUNT_TYPES', () => {
  it('covers exactly the three locked accounts', () => {
    expect(LOCKED_ACCOUNT_TYPES.size).toBe(3);
    expect(LOCKED_ACCOUNT_TYPES.has('bet_escrow')).toBe(true);
    expect(LOCKED_ACCOUNT_TYPES.has('bet_creation_fee_hold')).toBe(true);
    expect(LOCKED_ACCOUNT_TYPES.has('dispute_deposit_hold')).toBe(true);
    expect(LOCKED_ACCOUNT_TYPES.has('user_available')).toBe(false);
    expect(LOCKED_ACCOUNT_TYPES.has('platform_fee')).toBe(false);
  });
});

describe('computeBalanceDeltas', () => {
  it('credits to user_available bump availableDelta', () => {
    const entries: LedgerEntryInput[] = [
      {
        accountType: 'deposit_holding',
        accountRef: 'platform',
        direction: 'debit',
        amountUsdc: '100',
        reason: 'deposit',
      },
      {
        accountType: 'user_available',
        accountRef: userA,
        direction: 'credit',
        amountUsdc: '100',
        reason: 'deposit',
      },
    ];
    const deltas = computeBalanceDeltas(entries);
    expect(deltas.size).toBe(1);
    expect(deltas.get(userA)!.availableDelta.toString()).toBe('100');
    expect(deltas.get(userA)!.lockedDelta.toString()).toBe('0');
  });

  it('stake-lock moves available → locked for both users', () => {
    const entries: LedgerEntryInput[] = [
      {
        accountType: 'user_available',
        accountRef: userA,
        direction: 'debit',
        amountUsdc: '25',
        reason: 'stake_lock',
      },
      {
        accountType: 'bet_escrow',
        accountRef: betId,
        direction: 'credit',
        amountUsdc: '25',
        reason: 'stake_lock',
        affectsUserId: userA,
      },
      {
        accountType: 'user_available',
        accountRef: userB,
        direction: 'debit',
        amountUsdc: '25',
        reason: 'stake_lock',
      },
      {
        accountType: 'bet_escrow',
        accountRef: betId,
        direction: 'credit',
        amountUsdc: '25',
        reason: 'stake_lock',
        affectsUserId: userB,
      },
    ];
    const deltas = computeBalanceDeltas(entries);

    expect(deltas.get(userA)!.availableDelta.toString()).toBe('-25');
    expect(deltas.get(userA)!.lockedDelta.toString()).toBe('25');
    expect(deltas.get(userB)!.availableDelta.toString()).toBe('-25');
    expect(deltas.get(userB)!.lockedDelta.toString()).toBe('25');
  });

  it('ignores global accounts (platform_fee, treasury, etc.)', () => {
    const entries: LedgerEntryInput[] = [
      {
        accountType: 'user_available',
        accountRef: userA,
        direction: 'debit',
        amountUsdc: '5',
        reason: 'creation_fee_lock',
      },
      {
        accountType: 'platform_fee',
        accountRef: 'platform',
        direction: 'credit',
        amountUsdc: '5',
        reason: 'creation_fee_recognize',
      },
    ];
    const deltas = computeBalanceDeltas(entries);
    expect(deltas.size).toBe(1);
    expect(deltas.get(userA)!.availableDelta.toString()).toBe('-5');
  });

  it('aggregates multiple entries for the same user', () => {
    const entries: LedgerEntryInput[] = [
      {
        accountType: 'user_available',
        accountRef: userA,
        direction: 'credit',
        amountUsdc: '10.5',
        reason: 'deposit',
      },
      {
        accountType: 'user_available',
        accountRef: userA,
        direction: 'credit',
        amountUsdc: '4.5',
        reason: 'deposit',
      },
      {
        accountType: 'deposit_holding',
        accountRef: 'platform',
        direction: 'debit',
        amountUsdc: '15',
        reason: 'deposit',
      },
    ];
    const deltas = computeBalanceDeltas(entries);
    expect(deltas.get(userA)!.availableDelta.toString()).toBe('15');
  });
});
