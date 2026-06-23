import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { balances, ledgerEntries, onchainTransfers } from '@rivlayx/db';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { resolveEscrowConfig, type EscrowConfig } from './config';
import { StakeError, prepareStake } from './stake';

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
  escrowConfig = resolveEscrowConfig({ escrowWallet: addr(), network: 'devnet', maxStakeUsdc: '25' });
});

function input(over: Partial<Parameters<typeof prepareStake>[1]> = {}) {
  return {
    betId: randomUUID(),
    userId,
    fromWallet: addr(),
    amountUsdc: '10',
    ...over,
  };
}

describe('prepareStake', () => {
  it('creates a pending stake transfer record with escrow as destination', async () => {
    const args = input();
    const { transfer, created, transferInput } = await prepareStake(harness.db, args, { escrowConfig });

    expect(created).toBe(true);
    expect(transfer.status).toBe('pending');
    expect(transfer.type).toBe('stake');
    expect(transfer.destinationWallet).toBe(escrowConfig.escrowWallet);
    expect(transfer.sourceWallet).toBe(args.fromWallet);
    expect(transfer.idempotencyKey).toBe(`stake:${args.betId}:${userId}`);
    expect(transfer.txSignature).toBeNull();

    // transferInput is provider-ready and complete.
    expect(transferInput).toEqual({
      reference: `stake:${args.betId}:${userId}`,
      fromWallet: args.fromWallet,
      toWallet: escrowConfig.escrowWallet,
      amountUsdc: '10',
      betId: args.betId,
    });
  });

  it('is idempotent: same betId/userId returns the same record', async () => {
    const args = input();
    const first = await prepareStake(harness.db, args, { escrowConfig });
    const second = await prepareStake(harness.db, args, { escrowConfig });

    expect(second.created).toBe(false);
    expect(second.transfer.id).toBe(first.transfer.id);

    const rows = await harness.db.select().from(onchainTransfers);
    expect(rows).toHaveLength(1);
  });

  it('rejects an invalid source wallet', async () => {
    await expect(
      prepareStake(harness.db, input({ fromWallet: 'not-a-wallet' }), { escrowConfig }),
    ).rejects.toMatchObject({ code: 'INVALID_WALLET' });
  });

  it('rejects an amount above the stake cap', async () => {
    await expect(
      prepareStake(harness.db, input({ amountUsdc: '25.000001' }), { escrowConfig }),
    ).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
  });

  it('rejects a zero or negative amount', async () => {
    await expect(prepareStake(harness.db, input({ amountUsdc: '0' }), { escrowConfig })).rejects.toBeInstanceOf(
      StakeError,
    );
    await expect(prepareStake(harness.db, input({ amountUsdc: '-5' }), { escrowConfig })).rejects.toBeInstanceOf(
      StakeError,
    );
  });

  it('accepts an amount exactly at the cap', async () => {
    const { transfer } = await prepareStake(harness.db, input({ amountUsdc: '25' }), { escrowConfig });
    expect(transfer.status).toBe('pending');
  });

  it('touches no live money flow (no ledger entries, no balances)', async () => {
    await prepareStake(harness.db, input(), { escrowConfig });

    const ledger = await harness.db.select().from(ledgerEntries);
    const bal = await harness.db.select().from(balances);
    expect(ledger).toHaveLength(0);
    expect(bal).toHaveLength(0);
  });
});
