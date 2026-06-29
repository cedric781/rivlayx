import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { onchainTransfers } from '@rivlayx/db';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { USDC_MINT_ADDRESS } from '@rivlayx/shared';
import {
  OnchainTransferError,
  createTransferRecord,
  markFailed,
  markFinalized,
  markSubmitted,
  type CreateOnchainTransferInput,
} from './transfers';

let harness: TestDb;
let userId: string;

beforeAll(async () => {
  harness = await createTestDb();
});
afterAll(async () => {
  await harness.close();
});
beforeEach(async () => {
  await harness.pg.exec('TRUNCATE auth.users CASCADE; TRUNCATE financial.onchain_transfers;');
  const user = await createTestUser(harness.db);
  userId = user.id;
});

function stakeInput(over: Partial<CreateOnchainTransferInput> = {}): CreateOnchainTransferInput {
  const betId = randomUUID();
  return {
    type: 'stake',
    userId,
    betId,
    sourceWallet: 'UserWallet1111111111111111111111111111111111',
    destinationWallet: 'Escrow1111111111111111111111111111111111111',
    amountUsdc: '10',
    mint: USDC_MINT_ADDRESS,
    caip2: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
    idempotencyKey: `stake:${betId}:${userId}`,
    ...over,
  };
}

describe('createTransferRecord', () => {
  it('creates a pending record', async () => {
    const { transfer, created } = await createTransferRecord(harness.db, stakeInput());
    expect(created).toBe(true);
    expect(transfer.status).toBe('pending');
    expect(transfer.attempts).toBe(0);
    expect(transfer.txSignature).toBeNull();
  });

  it('is idempotent on idempotency_key (second create returns the same row)', async () => {
    const input = stakeInput();
    const first = await createTransferRecord(harness.db, input);
    const second = await createTransferRecord(harness.db, input);
    expect(second.created).toBe(false);
    expect(second.transfer.id).toBe(first.transfer.id);

    const rows = await harness.db.select().from(onchainTransfers);
    expect(rows).toHaveLength(1);
  });
});

describe('status transitions', () => {
  it('pending → submitted records the signature and bumps attempts', async () => {
    const { transfer } = await createTransferRecord(harness.db, stakeInput());
    const updated = await markSubmitted(harness.db, transfer.id, 'sig-abc');
    expect(updated.status).toBe('submitted');
    expect(updated.txSignature).toBe('sig-abc');
    expect(updated.attempts).toBe(1);
    expect(updated.submittedAt).not.toBeNull();
  });

  it('submitted → finalized stamps finality and the ledger txn', async () => {
    const { transfer } = await createTransferRecord(harness.db, stakeInput());
    await markSubmitted(harness.db, transfer.id, 'sig-fin');
    const ledgerTxnId = randomUUID();
    const updated = await markFinalized(harness.db, transfer.id, { ledgerTxnId });
    expect(updated.status).toBe('finalized');
    expect(updated.finalizedAt).not.toBeNull();
    expect(updated.ledgerTxnId).toBe(ledgerTxnId);
  });

  it('submitted → failed is terminal with the error reason', async () => {
    const { transfer } = await createTransferRecord(harness.db, stakeInput());
    await markSubmitted(harness.db, transfer.id, 'sig-fail');
    const updated = await markFailed(harness.db, transfer.id, 'permanent: bad destination');
    expect(updated.status).toBe('failed');
    expect(updated.lastError).toBe('permanent: bad destination');
    expect(updated.failedAt).not.toBeNull();
  });

  it('pending → failed is allowed (pre-submit failure)', async () => {
    const { transfer } = await createTransferRecord(harness.db, stakeInput());
    const updated = await markFailed(harness.db, transfer.id, 'rejected before submit');
    expect(updated.status).toBe('failed');
  });

  it('rejects an invalid transition: finalize while pending', async () => {
    const { transfer } = await createTransferRecord(harness.db, stakeInput());
    await expect(markFinalized(harness.db, transfer.id)).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
  });

  it('rejects an invalid transition: submit while finalized', async () => {
    const { transfer } = await createTransferRecord(harness.db, stakeInput());
    await markSubmitted(harness.db, transfer.id, 'sig-1');
    await markFinalized(harness.db, transfer.id);
    await expect(markSubmitted(harness.db, transfer.id, 'sig-2')).rejects.toBeInstanceOf(
      OnchainTransferError,
    );
  });

  it('throws NOT_FOUND for an unknown transfer id', async () => {
    await expect(markSubmitted(harness.db, randomUUID(), 'sig')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('tx_signature uniqueness', () => {
  it('rejects two submitted transfers sharing one signature', async () => {
    const a = await createTransferRecord(harness.db, stakeInput());
    const b = await createTransferRecord(harness.db, stakeInput());
    await markSubmitted(harness.db, a.transfer.id, 'dup-sig');
    await expect(markSubmitted(harness.db, b.transfer.id, 'dup-sig')).rejects.toThrow();
  });
});
