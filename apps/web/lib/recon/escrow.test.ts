import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { balances, ledgerEntries, onchainTransfers } from '@rivlayx/db';
import { ledger } from '@rivlayx/core';
import { MockHeliusRpc } from '@rivlayx/helius';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { reconcileEscrowAndEscalate } from './escrow';

// The mock RPC uses the ATA only as a lookup key — any stable string works, so
// apps/web tests don't need @solana/web3.js for key generation.
const ESCROW_ATA = 'EscrowAtaTestAddress11111111111111111111111';
const fakeAddr = () => randomUUID().replace(/-/g, '');

let harness: TestDb;
let userId: string;
let rpc: MockHeliusRpc;
let escrowAta: string;

beforeAll(async () => {
  harness = await createTestDb();
});
afterAll(async () => {
  await harness.close();
});
beforeEach(async () => {
  // Reset the financial state touched here so verdicts/freezes don't leak between tests.
  await harness.pg.exec(
    'TRUNCATE auth.users CASCADE; TRUNCATE financial.onchain_transfers; ' +
      'TRUNCATE financial.ledger_entries; TRUNCATE financial.balances; ' +
      'TRUNCATE financial.freeze_state;',
  );
  const user = await createTestUser(harness.db);
  userId = user.id;
  rpc = new MockHeliusRpc();
  escrowAta = ESCROW_ATA;
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

/** Seed the on-chain escrow ATA balance the mock RPC reports. */
function setOnChain(amountUsdc: string): void {
  rpc.setTokenAccountBalance(escrowAta, {
    amount: amountUsdc,
    decimals: 6,
    uiAmount: Number(amountUsdc),
    uiAmountString: amountUsdc,
  });
}

/** Insert one finalized stake transfer (feeds `expected`). */
async function seedFinalizedStake(amountUsdc: string): Promise<void> {
  await harness.db.insert(onchainTransfers).values({
    type: 'stake',
    userId,
    sourceWallet: fakeAddr(),
    destinationWallet: fakeAddr(),
    amountUsdc,
    mint: fakeAddr(),
    idempotencyKey: `stake:${randomUUID()}`,
    status: 'finalized',
  });
}

/** Build a `bet_escrow` ledger balance via a balanced debit/credit txn. */
async function setLedgerEscrow(amountUsdc: string): Promise<void> {
  const betId = randomUUID();
  await ledger.postLedgerTxn(harness.db, {
    txnId: randomUUID(),
    requestId: randomUUID(),
    createdBy: 'test',
    entries: [
      { accountType: 'deposit_holding', accountRef: 'platform', direction: 'debit', amountUsdc, reason: 'stake_lock' },
      {
        accountType: 'bet_escrow',
        accountRef: betId,
        direction: 'credit',
        amountUsdc,
        reason: 'stake_lock',
        affectsUserId: userId,
        betId,
      },
    ],
  });
}

describe('reconcileEscrowAndEscalate', () => {
  it('runs reconcileEscrow and returns its verdict (ok) without freezing', async () => {
    await seedFinalizedStake('50');
    await setLedgerEscrow('50');
    setOnChain('50'); // actual == expected == ledger

    const result = await reconcileEscrowAndEscalate(harness.db, { escrowAta, rpc });

    expect(result.status).toBe('ok');
    expect(await ledger.isFrozen(harness.db, 'settlements')).toBe(false);
    expect(await ledger.isFrozen(harness.db, 'withdrawals')).toBe(false);
  });

  it('freezes settlements + withdrawals on drift (the only side-effect)', async () => {
    await seedFinalizedStake('50');
    await setLedgerEscrow('50');
    setOnChain('45'); // physically short by 5 → drift

    const result = await reconcileEscrowAndEscalate(harness.db, { escrowAta, rpc });

    expect(result.status).toBe('drift');
    expect(result.driftAmount).toBe('5.000000'); // proves reconcileEscrow actually ran
    expect(await ledger.isFrozen(harness.db, 'settlements')).toBe(true);
    expect(await ledger.isFrozen(harness.db, 'withdrawals')).toBe(true);
  });

  it('moves no money: ledger + balances are untouched by the reconcile on drift', async () => {
    await seedFinalizedStake('50');
    await setLedgerEscrow('50');
    setOnChain('45'); // force a drift verdict

    const ledgerBefore = (await harness.db.select().from(ledgerEntries)).length;
    const balancesBefore = (await harness.db.select().from(balances)).length;

    await reconcileEscrowAndEscalate(harness.db, { escrowAta, rpc });

    const ledgerAfter = await harness.db.select().from(ledgerEntries);
    const balancesAfter = await harness.db.select().from(balances);

    expect(ledgerAfter).toHaveLength(ledgerBefore);
    expect(balancesAfter).toHaveLength(balancesBefore);
  });
});
