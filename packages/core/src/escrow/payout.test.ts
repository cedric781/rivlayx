import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { balances, ledgerEntries, onchainTransfers } from '@rivlayx/db';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { resolveEscrowConfig, type EscrowConfig } from './config';
import { PayoutError, preparePayout } from './payout';

const addr = () => Keypair.generate().publicKey.toBase58();

let harness: TestDb;
let userId: string;
let escrowConfig: EscrowConfig;

beforeAll(async () => {
  harness = await createTestDb();
});
afterAll(async () => {
  await harness.close();
});
beforeEach(async () => {
  await harness.pg.exec(
    'TRUNCATE auth.users CASCADE; TRUNCATE financial.onchain_transfers; ' +
      'TRUNCATE financial.ledger_entries; TRUNCATE financial.balances;',
  );
  const user = await createTestUser(harness.db);
  userId = user.id;
  // maxStakeUsdc '25' → maxPayoutUsdc derived as '50.000000' (two stakes).
  escrowConfig = resolveEscrowConfig({ escrowWallet: addr(), network: 'devnet', maxStakeUsdc: '25' });
});

function input(over: Partial<Parameters<typeof preparePayout>[1]> = {}) {
  return {
    betId: randomUUID(),
    winnerUserId: userId,
    winnerWallet: addr(),
    amountUsdc: '40',
    ...over,
  };
}

describe('preparePayout', () => {
  it('creates a pending settlement_payout record with escrow as source', async () => {
    const args = input();
    const { transfer, created, transferInput } = await preparePayout(harness.db, args, { escrowConfig });

    expect(created).toBe(true);
    expect(transfer.status).toBe('pending');
    expect(transfer.type).toBe('settlement_payout');
    expect(transfer.sourceWallet).toBe(escrowConfig.escrowWallet);
    expect(transfer.destinationWallet).toBe(args.winnerWallet);
    expect(transfer.idempotencyKey).toBe(`payout:${args.betId}`);
    expect(transfer.txSignature).toBeNull();

    // transferInput is provider-ready and complete.
    expect(transferInput).toEqual({
      reference: `payout:${args.betId}`,
      fromWallet: escrowConfig.escrowWallet,
      toWallet: args.winnerWallet,
      amountUsdc: '40',
      betId: args.betId,
    });
  });

  it('is idempotent: same betId returns the same record (a bet pays out once)', async () => {
    const args = input();
    const first = await preparePayout(harness.db, args, { escrowConfig });
    const second = await preparePayout(harness.db, args, { escrowConfig });

    expect(second.created).toBe(false);
    expect(second.transfer.id).toBe(first.transfer.id);

    const rows = await harness.db.select().from(onchainTransfers);
    expect(rows).toHaveLength(1);
  });

  it('rejects an invalid winner wallet', async () => {
    await expect(
      preparePayout(harness.db, input({ winnerWallet: 'not-a-wallet' }), { escrowConfig }),
    ).rejects.toMatchObject({ code: 'INVALID_WALLET' });
  });

  it('rejects a payout back to the escrow wallet', async () => {
    await expect(
      preparePayout(harness.db, input({ winnerWallet: escrowConfig.escrowWallet }), { escrowConfig }),
    ).rejects.toMatchObject({ code: 'INVALID_WALLET' });
  });

  it('rejects an amount above the payout cap', async () => {
    await expect(
      preparePayout(harness.db, input({ amountUsdc: '50.000001' }), { escrowConfig }),
    ).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
  });

  it('rejects a zero or negative amount', async () => {
    await expect(
      preparePayout(harness.db, input({ amountUsdc: '0' }), { escrowConfig }),
    ).rejects.toBeInstanceOf(PayoutError);
    await expect(
      preparePayout(harness.db, input({ amountUsdc: '-5' }), { escrowConfig }),
    ).rejects.toBeInstanceOf(PayoutError);
  });

  it('accepts an amount exactly at the cap (two full stakes)', async () => {
    const { transfer } = await preparePayout(harness.db, input({ amountUsdc: '50' }), { escrowConfig });
    expect(transfer.status).toBe('pending');
  });

  it('touches no live money flow (no ledger entries, no balances)', async () => {
    await preparePayout(harness.db, input(), { escrowConfig });

    const ledger = await harness.db.select().from(ledgerEntries);
    const bal = await harness.db.select().from(balances);
    expect(ledger).toHaveLength(0);
    expect(bal).toHaveLength(0);
  });
});
