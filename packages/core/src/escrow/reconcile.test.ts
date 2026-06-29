import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { balances, ledgerEntries, onchainTransfers, reconciliationRuns } from '@rivlayx/db';
import { MockHeliusRpc } from '@rivlayx/helius';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { postLedgerTxn } from '../ledger/post';
import { reconcileEscrow } from './reconcile';

const addr = () => Keypair.generate().publicKey.toBase58();

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
  await harness.pg.exec(
    'TRUNCATE auth.users CASCADE; TRUNCATE financial.onchain_transfers; ' +
      'TRUNCATE financial.ledger_entries; TRUNCATE financial.balances; ' +
      'TRUNCATE financial.reconciliation_runs;',
  );
  const user = await createTestUser(harness.db);
  userId = user.id;
  rpc = new MockHeliusRpc();
  escrowAta = addr();
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

/** Insert one onchain_transfers row with an explicit type/status. */
async function seedTransfer(
  type: 'stake' | 'settlement_payout' | 'withdrawal',
  status: 'pending' | 'submitted' | 'finalized' | 'failed',
  amountUsdc: string,
): Promise<void> {
  await harness.db.insert(onchainTransfers).values({
    type,
    userId,
    sourceWallet: addr(),
    destinationWallet: addr(),
    amountUsdc,
    mint: addr(),
    idempotencyKey: `${type}:${randomUUID()}`,
    status,
  });
}

/** Build a `bet_escrow` ledger balance via a balanced debit/credit txn. */
async function setLedgerEscrow(amountUsdc: string): Promise<void> {
  const betId = randomUUID();
  await postLedgerTxn(harness.db, {
    txnId: randomUUID(),
    requestId: randomUUID(),
    createdBy: 'test',
    entries: [
      {
        accountType: 'deposit_holding',
        accountRef: 'platform',
        direction: 'debit',
        amountUsdc,
        reason: 'stake_lock',
      },
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

describe('reconcileEscrow', () => {
  it('exact match (on-chain == expected == ledger) => ok', async () => {
    await seedTransfer('stake', 'finalized', '50');
    await setLedgerEscrow('50');
    setOnChain('50');

    const r = await reconcileEscrow(harness.db, { escrowAta, rpc });

    expect(r.status).toBe('ok');
    expect(r.actualBalance).toBe('50.000000');
    expect(r.expectedBalance).toBe('50.000000');
    expect(r.ledgerBalance).toBe('50.000000');
    expect(r.driftAmount).toBe('0.000000');
  });

  it('on-chain balance differs from expected => drift', async () => {
    await seedTransfer('stake', 'finalized', '50');
    await setLedgerEscrow('50');
    setOnChain('45'); // physically short by 5

    const r = await reconcileEscrow(harness.db, { escrowAta, rpc });

    expect(r.status).toBe('drift');
    expect(r.driftAmount).toBe('5.000000');
  });

  it('ledger balance differs from expected => drift', async () => {
    await seedTransfer('stake', 'finalized', '50');
    await setLedgerEscrow('48'); // ledger short by 2
    setOnChain('50');

    const r = await reconcileEscrow(harness.db, { escrowAta, rpc });

    expect(r.status).toBe('drift');
    expect(r.driftAmount).toBe('2.000000');
  });

  it('pending transfers are ignored in expected (and reported)', async () => {
    await seedTransfer('stake', 'finalized', '50');
    await seedTransfer('stake', 'pending', '30'); // in-flight, must not move expected
    await setLedgerEscrow('50');
    setOnChain('50');

    const r = await reconcileEscrow(harness.db, { escrowAta, rpc });

    expect(r.status).toBe('ok');
    expect(r.expectedBalance).toBe('50.000000');
    expect(r.pendingAmount).toBe('30.000000');
  });

  it('submitted transfers are ignored in expected but reported in submittedAmount', async () => {
    await seedTransfer('stake', 'finalized', '50');
    await seedTransfer('settlement_payout', 'submitted', '20'); // in-flight outbound
    await setLedgerEscrow('50');
    setOnChain('50');

    const r = await reconcileEscrow(harness.db, { escrowAta, rpc });

    expect(r.status).toBe('ok');
    expect(r.expectedBalance).toBe('50.000000');
    expect(r.submittedAmount).toBe('20.000000');
  });

  // ── C4: a submitted transfer whose on-chain tx already confirmed (funds physically
  // moved) but whose row is not yet `finalized` must not false-flag drift. ──

  it('submitted stake already landed on-chain stays within band => ok (no false drift)', async () => {
    await seedTransfer('stake', 'finalized', '50');
    await seedTransfer('stake', 'submitted', '30'); // tx confirmed, funds already in escrow
    await setLedgerEscrow('50'); // ledger reflects only the finalized stake-lock
    setOnChain('80'); // 50 finalized + 30 submitted-but-landed

    const r = await reconcileEscrow(harness.db, { escrowAta, rpc });

    expect(r.status).toBe('ok');
    expect(r.expectedBalance).toBe('50.000000');
    expect(r.expectedLowBalance).toBe('50.000000');
    expect(r.expectedHighBalance).toBe('80.000000');
    expect(r.driftAmount).toBe('0.000000');
  });

  it('submitted payout already left on-chain stays within band => ok (no false drift)', async () => {
    await seedTransfer('stake', 'finalized', '50');
    await seedTransfer('settlement_payout', 'submitted', '20'); // tx confirmed, funds already out
    await setLedgerEscrow('50'); // ledger still holds the un-released stake-lock
    setOnChain('30'); // 50 − 20 already moved out of escrow

    const r = await reconcileEscrow(harness.db, { escrowAta, rpc });

    expect(r.status).toBe('ok');
    expect(r.expectedBalance).toBe('50.000000');
    expect(r.expectedLowBalance).toBe('30.000000');
    expect(r.expectedHighBalance).toBe('50.000000');
    expect(r.driftAmount).toBe('0.000000');
  });

  it('on-chain balance above the submitted-stake band still flags drift', async () => {
    await seedTransfer('stake', 'finalized', '50');
    await seedTransfer('stake', 'submitted', '30'); // high edge = 80
    await setLedgerEscrow('50');
    setOnChain('85'); // 5 above the high edge — real surplus

    const r = await reconcileEscrow(harness.db, { escrowAta, rpc });

    expect(r.status).toBe('drift');
    expect(r.driftAmount).toBe('5.000000');
  });

  it('on-chain balance below the submitted-payout band still flags drift', async () => {
    await seedTransfer('stake', 'finalized', '50');
    await seedTransfer('settlement_payout', 'submitted', '20'); // low edge = 30
    await setLedgerEscrow('50');
    setOnChain('25'); // 5 below the low edge — real shortfall

    const r = await reconcileEscrow(harness.db, { escrowAta, rpc });

    expect(r.status).toBe('drift');
    expect(r.driftAmount).toBe('5.000000');
  });

  it('submitted band does not loosen the strict ledger check', async () => {
    await seedTransfer('stake', 'finalized', '50');
    await seedTransfer('stake', 'submitted', '30'); // widens on-chain band to [50, 80]
    await setLedgerEscrow('48'); // ledger short by 2 vs the finalized midpoint
    setOnChain('80'); // on-chain within band → on-chain side is clean

    const r = await reconcileEscrow(harness.db, { escrowAta, rpc });

    expect(r.status).toBe('drift');
    expect(r.driftAmount).toBe('2.000000'); // ledger drift only; band did not absorb it
  });

  it('finalized payout lowers expected', async () => {
    await seedTransfer('stake', 'finalized', '50');
    await seedTransfer('settlement_payout', 'finalized', '30'); // 50 in − 30 out = 20
    await setLedgerEscrow('20');
    setOnChain('20');

    const r = await reconcileEscrow(harness.db, { escrowAta, rpc });

    expect(r.status).toBe('ok');
    expect(r.expectedBalance).toBe('20.000000');
  });

  it('withdrawals do not count toward escrow expected', async () => {
    await seedTransfer('stake', 'finalized', '50');
    await seedTransfer('withdrawal', 'finalized', '25'); // user→external, not escrow
    await setLedgerEscrow('50');
    setOnChain('50');

    const r = await reconcileEscrow(harness.db, { escrowAta, rpc });

    expect(r.status).toBe('ok');
    expect(r.expectedBalance).toBe('50.000000');
  });

  it('halts on an inconsistent state (finalized payouts exceed stakes)', async () => {
    await seedTransfer('settlement_payout', 'finalized', '30'); // paid out with no stake
    setOnChain('0');

    const r = await reconcileEscrow(harness.db, { escrowAta, rpc });

    expect(r.status).toBe('halt');
    expect(r.expectedBalance).toBe('-30.000000');
  });

  it('threshold edge: drift exactly at threshold is ok, just over is drift', async () => {
    await seedTransfer('stake', 'finalized', '50');
    await setLedgerEscrow('50');

    setOnChain('50.01'); // exactly DRIFT_THRESHOLD (0.01) → ok
    const atEdge = await reconcileEscrow(harness.db, { escrowAta, rpc });
    expect(atEdge.status).toBe('ok');
    expect(atEdge.driftAmount).toBe('0.010000');

    setOnChain('50.010001'); // just over → drift
    const over = await reconcileEscrow(harness.db, { escrowAta, rpc });
    expect(over.status).toBe('drift');
  });

  it('is read-only: no ledger, balance, or reconciliation_runs writes', async () => {
    await seedTransfer('stake', 'finalized', '50');
    await setLedgerEscrow('50');
    setOnChain('45'); // force a drift verdict — must still write nothing

    const ledgerBefore = (await harness.db.select().from(ledgerEntries)).length;
    const balancesBefore = (await harness.db.select().from(balances)).length;

    await reconcileEscrow(harness.db, { escrowAta, rpc });

    const ledgerAfter = await harness.db.select().from(ledgerEntries);
    const balancesAfter = await harness.db.select().from(balances);
    const reconRuns = await harness.db.select().from(reconciliationRuns);

    expect(ledgerAfter).toHaveLength(ledgerBefore);
    expect(balancesAfter).toHaveLength(balancesBefore);
    expect(reconRuns).toHaveLength(0);
  });
});
