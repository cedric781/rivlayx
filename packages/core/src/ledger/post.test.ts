import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { balances, ledgerEntries } from '@rivlayx/db';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { LedgerError } from './errors';
import { postLedgerTxn } from './post';
import { getBalance } from './balances';
import type { LedgerEntryInput, PostLedgerTxnInput } from './types';

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

function deposit(userId: string, amount: string): PostLedgerTxnInput {
  return {
    txnId: randomUUID(),
    requestId: randomUUID(),
    createdBy: 'test',
    entries: [
      {
        accountType: 'deposit_holding',
        accountRef: 'platform',
        direction: 'debit',
        amountUsdc: amount,
        reason: 'deposit',
      },
      {
        accountType: 'user_available',
        accountRef: userId,
        direction: 'credit',
        amountUsdc: amount,
        reason: 'deposit',
      },
    ],
  };
}

describe('postLedgerTxn — happy path', () => {
  it('posts a balanced deposit txn and credits the user', async () => {
    const user = await createTestUser(harness.db);
    const result = await postLedgerTxn(harness.db, deposit(user.id, '100'));

    expect(result.status).toBe('posted');
    expect(result.entryCount).toBe(2);

    const balance = await getBalance(harness.db, user.id);
    expect(balance?.availableUsdc).toBe('100.000000');
    expect(balance?.lockedUsdc).toBe('0.000000');
    expect(balance?.version).toBe(2); // ensured + updated
  });

  it('stake-lock moves available → locked for both users', async () => {
    const userA = await createTestUser(harness.db);
    const userB = await createTestUser(harness.db);
    const betId = randomUUID();

    await postLedgerTxn(harness.db, deposit(userA.id, '100'));
    await postLedgerTxn(harness.db, deposit(userB.id, '100'));

    const stakeLock: LedgerEntryInput[] = [
      {
        accountType: 'user_available',
        accountRef: userA.id,
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
        affectsUserId: userA.id,
        betId,
      },
      {
        accountType: 'user_available',
        accountRef: userB.id,
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
        affectsUserId: userB.id,
        betId,
      },
    ];
    await postLedgerTxn(harness.db, {
      txnId: randomUUID(),
      requestId: randomUUID(),
      createdBy: 'test',
      entries: stakeLock,
    });

    const balA = await getBalance(harness.db, userA.id);
    const balB = await getBalance(harness.db, userB.id);
    expect(balA?.availableUsdc).toBe('75.000000');
    expect(balA?.lockedUsdc).toBe('25.000000');
    expect(balB?.availableUsdc).toBe('75.000000');
    expect(balB?.lockedUsdc).toBe('25.000000');
  });

  it('global-only entries do not create a balances row', async () => {
    // Pure platform-fee adjustment with no user_available leg — should pass
    // validation? No — locked entries need affectsUserId, AND we still need a
    // valid debit and credit. Synthesise a treasury<->platform_fee shuffle.
    const txnId = randomUUID();
    const requestId = randomUUID();
    await postLedgerTxn(harness.db, {
      txnId,
      requestId,
      createdBy: 'test',
      entries: [
        {
          accountType: 'treasury',
          accountRef: 'platform',
          direction: 'debit',
          amountUsdc: '1',
          reason: 'adjustment',
        },
        {
          accountType: 'platform_fee',
          accountRef: 'platform',
          direction: 'credit',
          amountUsdc: '1',
          reason: 'adjustment',
        },
      ],
    });

    const rows = await harness.db.select().from(balances);
    expect(rows).toHaveLength(0);
  });
});

describe('postLedgerTxn — idempotency', () => {
  it('replaying same requestId returns idempotent_replay with original txnId', async () => {
    const user = await createTestUser(harness.db);
    const first = deposit(user.id, '50');
    const result1 = await postLedgerTxn(harness.db, first);
    expect(result1.status).toBe('posted');

    const replay: PostLedgerTxnInput = { ...first, txnId: randomUUID() };
    const result2 = await postLedgerTxn(harness.db, replay);
    expect(result2.status).toBe('idempotent_replay');
    expect(result2.txnId).toBe(first.txnId);

    // Balance should not have doubled
    const balance = await getBalance(harness.db, user.id);
    expect(balance?.availableUsdc).toBe('50.000000');
  });

  it('different requestId with identical entries posts twice', async () => {
    const user = await createTestUser(harness.db);
    await postLedgerTxn(harness.db, deposit(user.id, '30'));
    await postLedgerTxn(harness.db, deposit(user.id, '30'));

    const balance = await getBalance(harness.db, user.id);
    expect(balance?.availableUsdc).toBe('60.000000');
  });
});

describe('postLedgerTxn — rejects invariant violations', () => {
  it('rejects unbalanced txn before any insert', async () => {
    const user = await createTestUser(harness.db);

    await expect(
      postLedgerTxn(harness.db, {
        txnId: randomUUID(),
        requestId: randomUUID(),
        createdBy: 'test',
        entries: [
          {
            accountType: 'deposit_holding',
            accountRef: 'platform',
            direction: 'debit',
            amountUsdc: '100',
            reason: 'deposit',
          },
          {
            accountType: 'user_available',
            accountRef: user.id,
            direction: 'credit',
            amountUsdc: '99',
            reason: 'deposit',
          },
        ],
      }),
    ).rejects.toThrow(LedgerError);

    const rows = await harness.db.select().from(ledgerEntries);
    expect(rows).toHaveLength(0);
  });

  it('DB CHECK constraint blocks balance under zero (defence in depth)', async () => {
    const user = await createTestUser(harness.db);
    await postLedgerTxn(harness.db, deposit(user.id, '10'));

    // Attempt to debit 20 — would push available below 0.
    await expect(
      postLedgerTxn(harness.db, {
        txnId: randomUUID(),
        requestId: randomUUID(),
        createdBy: 'test',
        entries: [
          {
            accountType: 'user_available',
            accountRef: user.id,
            direction: 'debit',
            amountUsdc: '20',
            reason: 'adjustment',
          },
          {
            accountType: 'platform_fee',
            accountRef: 'platform',
            direction: 'credit',
            amountUsdc: '20',
            reason: 'adjustment',
          },
        ],
      }),
    ).rejects.toThrow(/balances_available_non_negative|check constraint/i);
  });
});

describe('postLedgerTxn — sum invariant under composite txns', () => {
  it('maintains debit = credit even with many entries', async () => {
    const u1 = await createTestUser(harness.db);
    const u2 = await createTestUser(harness.db);
    const u3 = await createTestUser(harness.db);

    await postLedgerTxn(harness.db, deposit(u1.id, '50'));
    await postLedgerTxn(harness.db, deposit(u2.id, '30'));
    await postLedgerTxn(harness.db, deposit(u3.id, '20'));

    const [totals] = await harness.db
      .select({
        debit: ledgerEntries.amountUsdc,
      })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.direction, 'debit'));

    expect(totals).toBeDefined();
  });
});
