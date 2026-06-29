import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { deposits, wallets } from '@rivlayx/db';
import { USDC_MINT_ADDRESS } from '@rivlayx/shared';
import { MockHeliusRpc, buildMockTokenTransfer, parseSplTransfer } from '@rivlayx/helius';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { detectDeposit } from './detect';
import { confirmDeposit } from './confirm';
import { REQUIRED_CONFIRMATIONS, type DepositConfig } from './config';

const VAULT_ATA = 'VaultAta1111111111111111111111111111111111';
const PARSE_OPTS = { expectedMint: USDC_MINT_ADDRESS, expectedDestAta: VAULT_ATA };
const CONFIG: DepositConfig = {
  minDepositUsdc: '5',
  maxSingleDepositUsdc: '250',
  maxTvlUsdc: '1000',
  expectedDestAta: VAULT_ATA,
};

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

async function setupPendingDeposit(amount = 50): Promise<{ depositId: string; signature: string }> {
  const wallet = 'UserWallet111111111111111111111111111111111';
  const user = await createTestUser(harness.db);
  await harness.db.insert(wallets).values({
    userId: user.id,
    chain: 'solana',
    address: wallet,
    source: 'mock_dev',
    isPrimary: true,
  });
  const event = buildMockTokenTransfer({
    sourceWallet: wallet,
    destAta: VAULT_ATA,
    amountUsdc: amount,
  });
  const parsed = parseSplTransfer(event, PARSE_OPTS);
  const result = await detectDeposit(harness.db, parsed, CONFIG);
  if (result.kind !== 'deposit') throw new Error('expected pending deposit');
  return { depositId: result.depositId, signature: parsed.signature };
}

describe('confirmDeposit', () => {
  it('returns still_pending when RPC has no record', async () => {
    const { depositId } = await setupPendingDeposit();
    const result = await confirmDeposit(harness.db, rpc, depositId);
    expect(result.kind).toBe('still_pending');
    if (result.kind === 'still_pending') {
      expect(result.confirmations).toBe(0);
    }
  });

  it('transitions to confirmed when commitment=finalized', async () => {
    const { depositId, signature } = await setupPendingDeposit();
    rpc.setSignatureStatus(signature, {
      signature,
      confirmationStatus: 'finalized',
      confirmations: null,
      slot: 12345,
      err: null,
    });
    const result = await confirmDeposit(harness.db, rpc, depositId);
    expect(result.kind).toBe('confirmed');

    const [row] = await harness.db.select().from(deposits).where(eq(deposits.id, depositId));
    expect(row?.status).toBe('confirmed');
    expect(row?.confirmedAt).not.toBeNull();
  });

  it('C6A: stays pending at commitment=confirmed even with a high confirmation count', async () => {
    // Pre-finalized 'confirmed' is rollback-able; only 'finalized' may credit.
    const { depositId, signature } = await setupPendingDeposit();
    rpc.setSignatureStatus(signature, {
      signature,
      confirmationStatus: 'confirmed',
      confirmations: REQUIRED_CONFIRMATIONS,
      slot: 12345,
      err: null,
    });
    const result = await confirmDeposit(harness.db, rpc, depositId);
    expect(result.kind).toBe('still_pending');

    const [row] = await harness.db.select().from(deposits).where(eq(deposits.id, depositId));
    expect(row?.status).toBe('pending');
  });

  it('stays pending at commitment=processed', async () => {
    const { depositId, signature } = await setupPendingDeposit();
    rpc.setSignatureStatus(signature, {
      signature,
      confirmationStatus: 'processed',
      confirmations: 1,
      slot: 12345,
      err: null,
    });
    const result = await confirmDeposit(harness.db, rpc, depositId);
    expect(result.kind).toBe('still_pending');

    const [row] = await harness.db.select().from(deposits).where(eq(deposits.id, depositId));
    expect(row?.status).toBe('pending');
  });

  it('stays pending and updates count when confirmed (sub-finalized)', async () => {
    const { depositId, signature } = await setupPendingDeposit();
    rpc.setSignatureStatus(signature, {
      signature,
      confirmationStatus: 'confirmed',
      confirmations: 10,
      slot: 12345,
      err: null,
    });
    const result = await confirmDeposit(harness.db, rpc, depositId);
    expect(result.kind).toBe('still_pending');
    if (result.kind === 'still_pending') {
      expect(result.confirmations).toBe(10);
    }

    const [row] = await harness.db.select().from(deposits).where(eq(deposits.id, depositId));
    expect(row?.status).toBe('pending');
    expect(row?.confirmations).toBe(10);
  });

  it('marks deposit rejected when on-chain tx has an error', async () => {
    const { depositId, signature } = await setupPendingDeposit();
    rpc.setSignatureStatus(signature, {
      signature,
      confirmationStatus: 'finalized',
      confirmations: null,
      slot: 12345,
      err: { InstructionError: [0, 'InsufficientFunds'] },
    });
    const result = await confirmDeposit(harness.db, rpc, depositId);
    expect(result.kind).toBe('tx_failed');

    const [row] = await harness.db.select().from(deposits).where(eq(deposits.id, depositId));
    expect(row?.status).toBe('rejected');
    expect(row?.rejectionReason).toBe('tx_failed_on_chain');
  });

  it('returns not_found for unknown depositId', async () => {
    const result = await confirmDeposit(harness.db, rpc, '00000000-0000-0000-0000-000000000000');
    expect(result.kind).toBe('not_found');
  });

  it('refuses to act on a non-pending deposit', async () => {
    const { depositId } = await setupPendingDeposit();
    await harness.db
      .update(deposits)
      .set({ status: 'confirmed' })
      .where(eq(deposits.id, depositId));
    const result = await confirmDeposit(harness.db, rpc, depositId);
    expect(result.kind).toBe('wrong_status');
  });
});
