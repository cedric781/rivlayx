import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { ledgerEntries } from '@rivlayx/db';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { postLedgerTxn } from './post';
import { getBalance } from './balances';
import type { PostLedgerTxnInput } from './types';

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

describe('postLedgerTxn — concurrent identical requestId', () => {
  it('two concurrent posts with same requestId → exactly one set of ledger rows exists', async () => {
    const user = await createTestUser(harness.db);
    const requestId = randomUUID();

    function buildTxn(): PostLedgerTxnInput {
      return {
        txnId: randomUUID(),
        requestId,
        createdBy: 'test',
        entries: [
          {
            accountType: 'deposit_holding',
            accountRef: 'platform',
            direction: 'debit',
            amountUsdc: '40',
            reason: 'deposit',
          },
          {
            accountType: 'user_available',
            accountRef: user.id,
            direction: 'credit',
            amountUsdc: '40',
            reason: 'deposit',
          },
        ],
      };
    }

    const results = await Promise.allSettled([
      postLedgerTxn(harness.db, buildTxn()),
      postLedgerTxn(harness.db, buildTxn()),
    ]);

    // Either both fulfil (one posts, the other gets idempotent_replay) or
    // one fulfils and the other rejects with a unique-violation (race lost).
    // Both outcomes are acceptable; key invariant is no double-credit.
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    const balance = await getBalance(harness.db, user.id);
    expect(balance?.availableUsdc).toBe('40.000000');

    const rows = await harness.db
      .select({ id: ledgerEntries.id })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.requestId, requestId));
    expect(rows).toHaveLength(2); // one debit + one credit
  });
});
