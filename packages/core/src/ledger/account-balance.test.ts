import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { postLedgerTxn } from './post';
import { depositHoldingBalance, accountDebitMinusCredit } from './account-balance';

let harness: TestDb;

beforeAll(async () => {
  harness = await createTestDb();
});
afterAll(async () => {
  await harness.close();
});
beforeEach(async () => {
  await harness.pg.exec(
    'TRUNCATE auth.users CASCADE; TRUNCATE financial.ledger_entries; TRUNCATE financial.balances;',
  );
});

async function deposit(userId: string, amount: string): Promise<void> {
  await postLedgerTxn(harness.db, {
    txnId: randomUUID(),
    requestId: randomUUID(),
    createdBy: 'ab-test',
    entries: [
      { accountType: 'deposit_holding', accountRef: 'vault', direction: 'debit', amountUsdc: amount, reason: 'deposit' },
      { accountType: 'user_available', accountRef: userId, direction: 'credit', amountUsdc: amount, reason: 'deposit' },
    ],
  });
}

describe('depositHoldingBalance', () => {
  it('is zero on an empty ledger', async () => {
    expect((await depositHoldingBalance(harness.db)).toFixed(6)).toBe('0.000000');
  });

  it('equals Σdebit − Σcredit on deposit_holding (deposits up, payouts down)', async () => {
    const u = await createTestUser(harness.db);
    await deposit(u.id, '100');
    await deposit(u.id, '25');
    expect((await depositHoldingBalance(harness.db)).toFixed(6)).toBe('125.000000');

    // Simulate a payout draining the vault: credit deposit_holding 40.
    await postLedgerTxn(harness.db, {
      txnId: randomUUID(),
      requestId: randomUUID(),
      createdBy: 'ab-test',
      entries: [
        { accountType: 'user_available', accountRef: u.id, direction: 'debit', amountUsdc: '40', reason: 'withdrawal_complete' },
        { accountType: 'deposit_holding', accountRef: 'vault', direction: 'credit', amountUsdc: '40', reason: 'withdrawal_complete' },
      ],
    });
    expect((await depositHoldingBalance(harness.db)).toFixed(6)).toBe('85.000000');
  });

  it('accountDebitMinusCredit narrows by accountRef', async () => {
    const u = await createTestUser(harness.db);
    await deposit(u.id, '100');
    expect((await accountDebitMinusCredit(harness.db, 'deposit_holding', 'vault')).toFixed(6)).toBe('100.000000');
    expect((await accountDebitMinusCredit(harness.db, 'deposit_holding', 'nonexistent')).toFixed(6)).toBe('0.000000');
  });
});
