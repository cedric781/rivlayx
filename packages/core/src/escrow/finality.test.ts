import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { balances, freezeState, ledgerEntries, onchainTransfers } from '@rivlayx/db';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { reconcileTransferFinality, type FinalityChecker, type FinalityStatus } from './finality';

const fakeAddr = () => randomUUID().replace(/-/g, '');

/** Configurable fake finality checker: records calls, optionally throws. */
function makeChecker(
  map: Record<string, FinalityStatus> = {},
  opts: { throwFor?: string } = {},
): FinalityChecker & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    check(txSignature: string): Promise<FinalityStatus> {
      calls.push(txSignature);
      if (opts.throwFor === txSignature) return Promise.reject(new Error('rpc unavailable'));
      return Promise.resolve(map[txSignature] ?? 'pending');
    },
  };
}

let harness: TestDb;
let userId: string;

beforeAll(async () => {
  harness = await createTestDb();
});
afterAll(async () => {
  await harness.close();
});
beforeEach(async () => {
  await harness.pg.exec(
    'TRUNCATE auth.users CASCADE; TRUNCATE financial.onchain_transfers; ' +
      'TRUNCATE financial.ledger_entries; TRUNCATE financial.balances; TRUNCATE financial.freeze_state CASCADE;',
  );
  const user = await createTestUser(harness.db);
  userId = user.id;
});

/** Insert one onchain_transfers row with an explicit status + signature. */
async function seedTransfer(
  status: 'pending' | 'submitted' | 'finalized' | 'failed',
  txSignature: string | null,
): Promise<string> {
  const [row] = await harness.db
    .insert(onchainTransfers)
    .values({
      type: 'withdrawal',
      userId,
      sourceWallet: fakeAddr(),
      destinationWallet: fakeAddr(),
      amountUsdc: '10',
      mint: fakeAddr(),
      idempotencyKey: `withdrawal:${randomUUID()}`,
      status,
      txSignature,
    })
    .returning();
  return row!.id;
}

async function statusOf(id: string): Promise<string> {
  const [row] = await harness.db
    .select({ status: onchainTransfers.status })
    .from(onchainTransfers)
    .where(eq(onchainTransfers.id, id))
    .limit(1);
  return row!.status;
}

describe('reconcileTransferFinality', () => {
  it('submitted + finalized signature → finalized', async () => {
    const id = await seedTransfer('submitted', 'sig-final');
    const r = await reconcileTransferFinality(harness.db, makeChecker({ 'sig-final': 'finalized' }));

    expect(r.finalized).toBe(1);
    expect(r.checked).toBe(1);
    expect(await statusOf(id)).toBe('finalized');
  });

  it('submitted + failed signature → failed', async () => {
    const id = await seedTransfer('submitted', 'sig-fail');
    const r = await reconcileTransferFinality(harness.db, makeChecker({ 'sig-fail': 'failed' }));

    expect(r.failed).toBe(1);
    expect(await statusOf(id)).toBe('failed');
  });

  it('submitted + pending signature → remains submitted', async () => {
    const id = await seedTransfer('submitted', 'sig-pending');
    const r = await reconcileTransferFinality(harness.db, makeChecker({ 'sig-pending': 'pending' }));

    expect(r.stillPending).toBe(1);
    expect(r.finalized).toBe(0);
    expect(r.failed).toBe(0);
    expect(await statusOf(id)).toBe('submitted');
  });

  it('submitted without tx_signature → skipped (checker not called)', async () => {
    const id = await seedTransfer('submitted', null);
    const checker = makeChecker();
    const r = await reconcileTransferFinality(harness.db, checker);

    expect(r.skipped).toBe(1);
    expect(r.checked).toBe(0);
    expect(checker.calls).toHaveLength(0); // nothing to confirm
    expect(await statusOf(id)).toBe('submitted');
  });

  it('already finalized → unchanged (not selected, checker not called)', async () => {
    const id = await seedTransfer('finalized', 'sig-already-final');
    const checker = makeChecker({ 'sig-already-final': 'failed' }); // would flip it if (wrongly) selected
    const r = await reconcileTransferFinality(harness.db, checker);

    expect(r).toMatchObject({ checked: 0, finalized: 0, failed: 0 });
    expect(checker.calls).toHaveLength(0);
    expect(await statusOf(id)).toBe('finalized');
  });

  it('already failed → unchanged (not selected, checker not called)', async () => {
    const id = await seedTransfer('failed', 'sig-already-fail');
    const checker = makeChecker({ 'sig-already-fail': 'finalized' });
    const r = await reconcileTransferFinality(harness.db, checker);

    expect(r).toMatchObject({ checked: 0, finalized: 0, failed: 0 });
    expect(checker.calls).toHaveLength(0);
    expect(await statusOf(id)).toBe('failed');
  });

  it('a duplicate run is safe (finalized stays finalized, no re-processing)', async () => {
    const id = await seedTransfer('submitted', 'sig-dup');
    const checker = makeChecker({ 'sig-dup': 'finalized' });

    const first = await reconcileTransferFinality(harness.db, checker);
    const second = await reconcileTransferFinality(harness.db, checker);

    expect(first.finalized).toBe(1);
    expect(second.finalized).toBe(0); // already finalized → not selected on the 2nd run
    expect(checker.calls).toHaveLength(1); // checked exactly once across both runs
    expect(await statusOf(id)).toBe('finalized');
  });

  it('a checker error leaves the transfer submitted and is retryable', async () => {
    const id = await seedTransfer('submitted', 'sig-flaky');

    const r1 = await reconcileTransferFinality(harness.db, makeChecker({}, { throwFor: 'sig-flaky' }));
    expect(r1.errored).toBe(1);
    expect(r1.finalized).toBe(0);
    expect(await statusOf(id)).toBe('submitted'); // left for a later run

    // A later run with the chain now confirming the signature finalizes it.
    const r2 = await reconcileTransferFinality(harness.db, makeChecker({ 'sig-flaky': 'finalized' }));
    expect(r2.finalized).toBe(1);
    expect(await statusOf(id)).toBe('finalized');
  });

  it('processes a mixed batch correctly', async () => {
    await seedTransfer('submitted', 'm-final');
    await seedTransfer('submitted', 'm-fail');
    await seedTransfer('submitted', 'm-pending');
    await seedTransfer('submitted', null);
    const checker = makeChecker({ 'm-final': 'finalized', 'm-fail': 'failed', 'm-pending': 'pending' });

    const r = await reconcileTransferFinality(harness.db, checker);

    expect(r).toMatchObject({ checked: 3, finalized: 1, failed: 1, stillPending: 1, skipped: 1, errored: 0 });
  });

  it('writes no ledger, balance, or freeze rows', async () => {
    await seedTransfer('submitted', 'sig-nowrite');
    const ledgerBefore = (await harness.db.select().from(ledgerEntries)).length;
    const balancesBefore = (await harness.db.select().from(balances)).length;
    const freezeBefore = (await harness.db.select().from(freezeState)).length;

    await reconcileTransferFinality(harness.db, makeChecker({ 'sig-nowrite': 'finalized' }));

    expect(await harness.db.select().from(ledgerEntries)).toHaveLength(ledgerBefore);
    expect(await harness.db.select().from(balances)).toHaveLength(balancesBefore);
    expect(await harness.db.select().from(freezeState)).toHaveLength(freezeBefore);
  });
});
