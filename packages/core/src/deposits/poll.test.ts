import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { balances, deposits, wallets } from '@rivlayx/db';
import { USDC_MINT_ADDRESS } from '@rivlayx/shared';
import { MockHeliusRpc, buildMockTokenTransfer, parseSplTransfer, type SignatureStatus } from '@rivlayx/helius';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { detectDeposit } from './detect';
import { processPendingDeposits } from './poll';
import type { DepositConfig } from './config';

const VAULT_ATA = 'VaultAta1111111111111111111111111111111111';
const PARSE_OPTS = { expectedMint: USDC_MINT_ADDRESS, expectedDestAta: VAULT_ATA };
const CONFIG: DepositConfig = {
  minDepositUsdc: '5',
  maxSingleDepositUsdc: '250',
  maxTvlUsdc: '1000',
  expectedDestAta: VAULT_ATA,
};

const FINALIZED = (signature: string): SignatureStatus => ({
  signature,
  confirmationStatus: 'finalized',
  confirmations: null,
  slot: 100,
  err: null,
});

let harness: TestDb;
let rpc: MockHeliusRpc;

beforeAll(async () => {
  harness = await createTestDb();
});
afterAll(async () => {
  await harness.close();
});
beforeEach(async () => {
  rpc = new MockHeliusRpc();
  await harness.pg.exec(
    'TRUNCATE auth.users CASCADE; TRUNCATE financial.ledger_entries; ' +
      'TRUNCATE financial.balances; TRUNCATE financial.deposits;',
  );
});

let walletCounter = 0;
async function pendingDeposit(amount = 50): Promise<{ depositId: string; signature: string; userId: string }> {
  const wallet = `UserWallet${(walletCounter++).toString().padStart(33, '0')}`;
  const user = await createTestUser(harness.db);
  await harness.db
    .insert(wallets)
    .values({ userId: user.id, chain: 'solana', address: wallet, source: 'mock_dev', isPrimary: true });
  const event = buildMockTokenTransfer({ sourceWallet: wallet, destAta: VAULT_ATA, amountUsdc: amount });
  const parsed = parseSplTransfer(event, PARSE_OPTS);
  const result = await detectDeposit(harness.db, parsed, CONFIG);
  if (result.kind !== 'deposit') throw new Error(`expected pending deposit, got ${result.kind}`);
  return { depositId: result.depositId, signature: parsed.signature, userId: user.id };
}

async function balanceOf(userId: string): Promise<string> {
  const [row] = await harness.db.select().from(balances).where(eq(balances.userId, userId));
  return row?.availableUsdc ?? '0';
}

describe('processPendingDeposits', () => {
  it('credits a finalized pending deposit (pending → confirmed → credited)', async () => {
    const { depositId, signature, userId } = await pendingDeposit(50);
    rpc.setSignatureStatus(signature, FINALIZED(signature));

    const result = await processPendingDeposits(harness.db, rpc);
    expect(result.credited).toBe(1);

    const [row] = await harness.db.select().from(deposits).where(eq(deposits.id, depositId));
    expect(row?.status).toBe('credited');
    expect(await balanceOf(userId)).toBe('50.000000');
  });

  it('leaves a confirmed (sub-finalized) deposit pending and credits nothing', async () => {
    const { depositId, signature, userId } = await pendingDeposit();
    rpc.setSignatureStatus(signature, { signature, confirmationStatus: 'confirmed', confirmations: 50, slot: 1, err: null });

    const result = await processPendingDeposits(harness.db, rpc);
    expect(result.credited).toBe(0);
    expect(result.stillPending).toBe(1);

    const [row] = await harness.db.select().from(deposits).where(eq(deposits.id, depositId));
    expect(row?.status).toBe('pending');
    expect(await balanceOf(userId)).toBe('0');
  });

  it('leaves a processed deposit pending', async () => {
    const { signature } = await pendingDeposit();
    rpc.setSignatureStatus(signature, { signature, confirmationStatus: 'processed', confirmations: 1, slot: 1, err: null });
    const result = await processPendingDeposits(harness.db, rpc);
    expect(result.stillPending).toBe(1);
    expect(result.credited).toBe(0);
  });

  it('leaves an unknown-signature deposit pending (RPC has no record)', async () => {
    await pendingDeposit(); // no status set in the mock
    const result = await processPendingDeposits(harness.db, rpc);
    expect(result.stillPending).toBe(1);
    expect(result.credited).toBe(0);
  });

  it('rejects a deposit whose tx errored on chain', async () => {
    const { depositId, userId } = await pendingDeposit();
    const [row0] = await harness.db.select().from(deposits).where(eq(deposits.id, depositId));
    rpc.setSignatureStatus(row0!.txSignature, {
      signature: row0!.txSignature,
      confirmationStatus: 'finalized',
      confirmations: null,
      slot: 1,
      err: { InstructionError: [0, 'X'] },
    });

    const result = await processPendingDeposits(harness.db, rpc);
    expect(result.rejected).toBe(1);
    expect(result.credited).toBe(0);

    const [row] = await harness.db.select().from(deposits).where(eq(deposits.id, depositId));
    expect(row?.status).toBe('rejected');
    expect(await balanceOf(userId)).toBe('0');
  });

  it('never credits when the RPC throws (left pending, counted errored)', async () => {
    const { depositId, userId } = await pendingDeposit();
    const throwingRpc = {
      getSignatureStatus: () => Promise.reject(new Error('RPC timeout')),
      getTokenAccountBalance: () => Promise.reject(new Error('n/a')),
      getSignaturesForAddress: () => Promise.reject(new Error('n/a')),
    };

    const result = await processPendingDeposits(harness.db, throwingRpc);
    expect(result.errored).toBe(1);
    expect(result.credited).toBe(0);

    const [row] = await harness.db.select().from(deposits).where(eq(deposits.id, depositId));
    expect(row?.status).toBe('pending');
    expect(await balanceOf(userId)).toBe('0');
  });

  it('is idempotent: a second run does not double-credit', async () => {
    const { signature, userId } = await pendingDeposit(50);
    rpc.setSignatureStatus(signature, FINALIZED(signature));

    await processPendingDeposits(harness.db, rpc);
    const second = await processPendingDeposits(harness.db, rpc);

    // Already credited → no longer 'pending', so not even re-selected.
    expect(second.credited).toBe(0);
    expect(second.candidatesSeen).toBe(0);
    expect(await balanceOf(userId)).toBe('50.000000');
  });

  it('respects the batch limit', async () => {
    const a = await pendingDeposit(10);
    const b = await pendingDeposit(20);
    rpc.setSignatureStatus(a.signature, FINALIZED(a.signature));
    rpc.setSignatureStatus(b.signature, FINALIZED(b.signature));

    const result = await processPendingDeposits(harness.db, rpc, { limit: 1 });
    expect(result.candidatesSeen).toBe(1);
    expect(result.credited).toBe(1);
  });
});
