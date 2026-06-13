import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LedgerError } from './errors';
import { validateLedgerTxn } from './validate';
import type { LedgerEntryInput, PostLedgerTxnInput } from './types';

const userA = randomUUID();
const userB = randomUUID();
const betId = randomUUID();

function txn(entries: LedgerEntryInput[]): PostLedgerTxnInput {
  return {
    txnId: randomUUID(),
    requestId: randomUUID(),
    createdBy: 'test',
    entries,
  };
}

describe('validateLedgerTxn — happy path', () => {
  it('accepts a balanced deposit txn', () => {
    const result = validateLedgerTxn(
      txn([
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
      ]),
    );
    expect(result.entries).toHaveLength(2);
  });

  it('accepts a balanced 4-row stake-lock txn', () => {
    const result = validateLedgerTxn(
      txn([
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
      ]),
    );
    expect(result.entries).toHaveLength(4);
  });
});

describe('validateLedgerTxn — invariant violations', () => {
  it('rejects unbalanced txn', () => {
    const e = expect(() =>
      validateLedgerTxn(
        txn([
          {
            accountType: 'user_available',
            accountRef: userA,
            direction: 'debit',
            amountUsdc: '50',
            reason: 'deposit',
          },
          {
            accountType: 'user_available',
            accountRef: userB,
            direction: 'credit',
            amountUsdc: '49',
            reason: 'deposit',
          },
        ]),
      ),
    );
    e.toThrowError(LedgerError);
    e.toThrowError(/UNBALANCED|!=/);
  });

  it('rejects single-sided txn (only debits)', () => {
    expect(() =>
      validateLedgerTxn(
        txn([
          {
            accountType: 'user_available',
            accountRef: userA,
            direction: 'debit',
            amountUsdc: '10',
            reason: 'adjustment',
          },
          {
            accountType: 'user_available',
            accountRef: userB,
            direction: 'debit',
            amountUsdc: '10',
            reason: 'adjustment',
          },
        ]),
      ),
    ).toThrowError(LedgerError);
  });

  it('rejects zero amounts', () => {
    expect(() =>
      validateLedgerTxn(
        txn([
          {
            accountType: 'user_available',
            accountRef: userA,
            direction: 'debit',
            amountUsdc: '0',
            reason: 'deposit',
          },
          {
            accountType: 'user_available',
            accountRef: userB,
            direction: 'credit',
            amountUsdc: '0',
            reason: 'deposit',
          },
        ]),
      ),
    ).toThrowError(/AMOUNT_NOT_POSITIVE|decimal|must be/);
  });

  it('rejects locked-account entries without affectsUserId', () => {
    expect(() =>
      validateLedgerTxn(
        txn([
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
            // affectsUserId intentionally omitted
          },
        ]),
      ),
    ).toThrowError(/MISSING_AFFECTS_USER|affectsUserId/);
  });

  it('rejects user_available with mismatched affectsUserId', () => {
    expect(() =>
      validateLedgerTxn(
        txn([
          {
            accountType: 'user_available',
            accountRef: userA,
            direction: 'debit',
            amountUsdc: '5',
            reason: 'adjustment',
            affectsUserId: userB, // wrong
          },
          {
            accountType: 'platform_fee',
            accountRef: 'platform',
            direction: 'credit',
            amountUsdc: '5',
            reason: 'adjustment',
          },
        ]),
      ),
    ).toThrowError(/INCONSISTENT_AFFECTS_USER|equal/);
  });

  it('rejects user_available with non-UUID accountRef', () => {
    expect(() =>
      validateLedgerTxn(
        txn([
          {
            accountType: 'user_available',
            accountRef: 'not-a-uuid',
            direction: 'debit',
            amountUsdc: '5',
            reason: 'adjustment',
          },
          {
            accountType: 'platform_fee',
            accountRef: 'platform',
            direction: 'credit',
            amountUsdc: '5',
            reason: 'adjustment',
          },
        ]),
      ),
    ).toThrowError(/INVALID_USER_REF|UUID/);
  });

  it('rejects amounts with more than 6 decimal places', () => {
    expect(() =>
      validateLedgerTxn(
        txn([
          {
            accountType: 'user_available',
            accountRef: userA,
            direction: 'debit',
            amountUsdc: '0.0000001',
            reason: 'deposit',
          },
          {
            accountType: 'user_available',
            accountRef: userB,
            direction: 'credit',
            amountUsdc: '0.0000001',
            reason: 'deposit',
          },
        ]),
      ),
    ).toThrowError(LedgerError);
  });

  it('rejects under 2 entries', () => {
    expect(() =>
      validateLedgerTxn({
        txnId: randomUUID(),
        requestId: randomUUID(),
        createdBy: 'test',
        entries: [
          {
            accountType: 'user_available',
            accountRef: userA,
            direction: 'debit',
            amountUsdc: '1',
            reason: 'adjustment',
          },
        ],
      }),
    ).toThrowError(LedgerError);
  });
});
