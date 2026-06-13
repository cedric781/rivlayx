import Decimal from 'decimal.js';
import type { AccountType } from '@rivlayx/db';
import type { LedgerEntryInput } from './types';

/**
 * Locked-account types whose entries move a specific user's
 * `balances.locked_usdc`. Each such entry requires `affectsUserId`.
 */
export const LOCKED_ACCOUNT_TYPES: ReadonlySet<AccountType> = new Set<AccountType>([
  'bet_escrow',
  'bet_creation_fee_hold',
  'dispute_deposit_hold',
]);

/**
 * Account behaviour summary (for reviewer reference):
 *
 *   user_available           liability per user (debit ↓ / credit ↑)
 *   bet_escrow               liability per bet  (affectsUserId attributes lock)
 *   bet_creation_fee_hold    liability per bet  (affectsUserId required)
 *   dispute_deposit_hold     liability per bet  (affectsUserId required)
 *   platform_fee             equity (credit ↑)
 *   treasury                 equity (credit ↑)
 *   deposit_holding          asset  (debit ↑ / credit ↓)
 *   withdrawal_pending       asset  (debit ↑ / credit ↓)
 */

export interface BalanceDelta {
  availableDelta: Decimal;
  lockedDelta: Decimal;
}

function zeroDelta(): BalanceDelta {
  return { availableDelta: new Decimal(0), lockedDelta: new Decimal(0) };
}

/**
 * Aggregate per-user balance deltas from a list of (validated) ledger entries.
 * Only `user_available` and the three locked-account types contribute to a
 * user's denormalised balance; global accounts are skipped.
 */
export function computeBalanceDeltas(
  entries: readonly LedgerEntryInput[],
): Map<string, BalanceDelta> {
  const result = new Map<string, BalanceDelta>();

  function add(userId: string, availDelta: Decimal, lockDelta: Decimal): void {
    const current = result.get(userId) ?? zeroDelta();
    current.availableDelta = current.availableDelta.add(availDelta);
    current.lockedDelta = current.lockedDelta.add(lockDelta);
    result.set(userId, current);
  }

  for (const e of entries) {
    const amount = new Decimal(e.amountUsdc);
    const signed = e.direction === 'credit' ? amount : amount.neg();

    if (e.accountType === 'user_available') {
      add(e.accountRef, signed, new Decimal(0));
    } else if (LOCKED_ACCOUNT_TYPES.has(e.accountType) && e.affectsUserId) {
      add(e.affectsUserId, new Decimal(0), signed);
    }
    // Other account types do not affect user balances.
  }

  return result;
}
