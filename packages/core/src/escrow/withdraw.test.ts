import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { balances, ledgerEntries, onchainTransfers } from '@rivlayx/db';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { resolveEscrowConfig, type EscrowConfig } from './config';
import { WithdrawError, prepareWithdrawal } from './withdraw';

const addr = () => Keypair.generate().publicKey.toBase58();

let harness: TestDb;
let userId: string;
let escrowConfig: EscrowConfig;
// Per-request withdrawal cap used across these tests.
const MAX_WITHDRAW = '25';

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

function input(over: Partial<Parameters<typeof prepareWithdrawal>[1]> = {}) {
  return {
    requestId: randomUUID(),
    userId,
    fromWallet: addr(),
    destinationWallet: addr(),
    amountUsdc: '20',
    ...over,
  };
}

// Lazy: escrowConfig is (re)assigned in beforeEach, so read it per call.
const opts = () => ({ escrowConfig, maxWithdrawUsdc: MAX_WITHDRAW });

describe('prepareWithdrawal', () => {
  it('creates a pending withdrawal record with the user wallet as source', async () => {
    const args = input();
    const { transfer, created, transferInput } = await prepareWithdrawal(harness.db, args, {
      escrowConfig,
      maxWithdrawUsdc: MAX_WITHDRAW,
    });

    expect(created).toBe(true);
    expect(transfer.status).toBe('pending');
    expect(transfer.type).toBe('withdrawal');
    expect(transfer.betId).toBeNull();
    expect(transfer.sourceWallet).toBe(args.fromWallet);
    expect(transfer.destinationWallet).toBe(args.destinationWallet);
    expect(transfer.idempotencyKey).toBe(`withdrawal:${args.requestId}`);
    expect(transfer.txSignature).toBeNull();

    // transferInput is provider-ready and complete.
    expect(transferInput).toEqual({
      reference: `withdrawal:${args.requestId}`,
      fromWallet: args.fromWallet,
      toWallet: args.destinationWallet,
      amountUsdc: '20',
      betId: args.requestId,
    });
  });

  it('is idempotent: same requestId returns the same record', async () => {
    const args = input();
    const first = await prepareWithdrawal(harness.db, args, { escrowConfig, maxWithdrawUsdc: MAX_WITHDRAW });
    const second = await prepareWithdrawal(harness.db, args, { escrowConfig, maxWithdrawUsdc: MAX_WITHDRAW });

    expect(second.created).toBe(false);
    expect(second.transfer.id).toBe(first.transfer.id);

    const rows = await harness.db.select().from(onchainTransfers);
    expect(rows).toHaveLength(1);
  });

  it('rejects an invalid source wallet', async () => {
    await expect(
      prepareWithdrawal(harness.db, input({ fromWallet: 'not-a-wallet' }), opts()),
    ).rejects.toMatchObject({ code: 'INVALID_WALLET' });
  });

  it('rejects an invalid destination wallet', async () => {
    await expect(
      prepareWithdrawal(harness.db, input({ destinationWallet: 'not-a-wallet' }), opts()),
    ).rejects.toMatchObject({ code: 'INVALID_WALLET' });
  });

  it('rejects a withdrawal to the escrow wallet', async () => {
    await expect(
      prepareWithdrawal(harness.db, input({ destinationWallet: escrowConfig.escrowWallet }), opts()),
    ).rejects.toMatchObject({ code: 'INVALID_WALLET' });
  });

  it('rejects a withdrawal back to the source wallet (self-transfer)', async () => {
    const fromWallet = addr();
    await expect(
      prepareWithdrawal(harness.db, input({ fromWallet, destinationWallet: fromWallet }), opts()),
    ).rejects.toMatchObject({ code: 'INVALID_WALLET' });
  });

  it('rejects an amount above the withdrawal cap', async () => {
    await expect(
      prepareWithdrawal(harness.db, input({ amountUsdc: '25.000001' }), opts()),
    ).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
  });

  it('rejects a zero or negative amount', async () => {
    await expect(prepareWithdrawal(harness.db, input({ amountUsdc: '0' }), opts())).rejects.toBeInstanceOf(
      WithdrawError,
    );
    await expect(prepareWithdrawal(harness.db, input({ amountUsdc: '-5' }), opts())).rejects.toBeInstanceOf(
      WithdrawError,
    );
  });

  it('accepts an amount exactly at the cap', async () => {
    const { transfer } = await prepareWithdrawal(harness.db, input({ amountUsdc: '25' }), opts());
    expect(transfer.status).toBe('pending');
  });

  it('touches no live money flow (no ledger entries, no balances)', async () => {
    await prepareWithdrawal(harness.db, input(), opts());

    const ledger = await harness.db.select().from(ledgerEntries);
    const bal = await harness.db.select().from(balances);
    expect(ledger).toHaveLength(0);
    expect(bal).toHaveLength(0);
  });
});
