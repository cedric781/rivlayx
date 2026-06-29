import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { onchainTransfers, wallets, withdrawalRequests } from '@rivlayx/db';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { fundUser } from '../bets/test-helpers';
import { setFreeze } from '../ledger/freeze';
import { resolveEscrowConfig, type EscrowConfig } from '../escrow/config';
import { markFinalized } from '../escrow/transfers';
import { PrivySolanaTransferProvider } from '../payouts/privy-transfer';
import type { PrivyTransferPolicy } from '../payouts/privy-policy';
import type { PrivySignAndSendRequest, PrivySolanaSigner } from '../payouts/privy-signer-port';
import { TransferRetryableError } from '../payouts/errors';
import { executePrivyWithdrawal } from './privy-flow';

const addr = () => Keypair.generate().publicKey.toBase58();

/** Delegated signer stub: records every request, idempotent on idempotencyKey. */
class RecordingSigner implements PrivySolanaSigner {
  readonly calls: PrivySignAndSendRequest[] = [];
  private readonly sigs = new Map<string, string>();
  signAndSend(req: PrivySignAndSendRequest): Promise<{ txSignature: string }> {
    this.calls.push(req);
    const existing = this.sigs.get(req.idempotencyKey);
    if (existing) return Promise.resolve({ txSignature: existing });
    const sig = `sig-${this.sigs.size + 1}`;
    this.sigs.set(req.idempotencyKey, sig);
    return Promise.resolve({ txSignature: sig });
  }
}

let harness: TestDb;
let userId: string;
let userWallet: string;
let escrowConfig: EscrowConfig;
let signer: RecordingSigner;
let provider: PrivySolanaTransferProvider;

beforeAll(async () => {
  harness = await createTestDb();
});
afterAll(async () => {
  await harness.close();
});

async function seedWallet(delegated: boolean, address = addr()): Promise<string> {
  await harness.db.insert(wallets).values({
    userId,
    chain: 'solana',
    address,
    source: 'privy_embedded',
    isPrimary: true,
    delegated,
  });
  return address;
}

/** Seed a prior in-window withdrawal that counts toward the rolling daily cap. */
async function seedPaidWithdrawal(amount: string): Promise<void> {
  await harness.db.insert(withdrawalRequests).values({
    userId,
    amountUsdc: amount,
    destinationWallet: addr(),
    availableAtRequestUsdc: amount,
    status: 'paid',
  });
}

beforeEach(async () => {
  await harness.pg.exec(
    'TRUNCATE auth.users CASCADE; TRUNCATE financial.onchain_transfers; ' +
      'TRUNCATE financial.ledger_entries; TRUNCATE financial.balances; ' +
      'TRUNCATE financial.withdrawal_requests CASCADE; TRUNCATE financial.freeze_state CASCADE;',
  );
  const user = await createTestUser(harness.db);
  userId = user.id;
  userWallet = await seedWallet(true); // delegated embedded wallet by default
  await fundUser(harness.db, userId, '1000'); // ample available balance for the guards

  escrowConfig = resolveEscrowConfig({ escrowWallet: addr(), network: 'devnet', maxStakeUsdc: '25' });
  signer = new RecordingSigner();
  const policy: PrivyTransferPolicy = {
    usdcMint: escrowConfig.usdcMint,
    allowDynamicDestinations: true,
    deniedDestinations: [escrowConfig.escrowWallet],
    maxAmountUsdc: '25',
  };
  provider = new PrivySolanaTransferProvider({
    signer,
    policy,
    caip2: escrowConfig.caip2,
    feePayer: addr(),
  });
});

describe('executePrivyWithdrawal', () => {
  it('signs end-to-end from the delegated embedded wallet and records the transfer', async () => {
    const requestId = randomUUID();
    const destination = addr();

    const result = await executePrivyWithdrawal(
      harness.db,
      { requestId, userId, destinationWallet: destination, amountUsdc: '10' },
      { escrowConfig, provider },
    );

    expect(result.created).toBe(true);
    expect(result.txSignature).toBe('sig-1');
    expect(result.transfer.type).toBe('withdrawal');
    expect(result.transfer.status).toBe('submitted');
    expect(result.transfer.sourceWallet).toBe(userWallet); // delegated source
    expect(result.transfer.destinationWallet).toBe(destination);
    expect(result.transfer.txSignature).toBe('sig-1');

    // The delegated signer received the user's wallet, the withdrawal idempotency
    // key, and the configured cluster.
    expect(signer.calls).toHaveLength(1);
    expect(signer.calls[0]?.fromWallet).toBe(userWallet);
    expect(signer.calls[0]?.idempotencyKey).toBe(`withdrawal:${requestId}`);
    expect(signer.calls[0]?.caip2).toBe(escrowConfig.caip2);

    const rows = await harness.db.select().from(onchainTransfers);
    expect(rows).toHaveLength(1);
  });

  it('is idempotent + replay-safe on requestId (same signature, one record)', async () => {
    const requestId = randomUUID();
    const destination = addr();
    const input = { requestId, userId, destinationWallet: destination, amountUsdc: '10' };

    const first = await executePrivyWithdrawal(harness.db, input, { escrowConfig, provider });
    const second = await executePrivyWithdrawal(harness.db, input, { escrowConfig, provider });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false); // replayed existing record
    expect(second.txSignature).toBe(first.txSignature); // never a second signature
    const rows = await harness.db.select().from(onchainTransfers);
    expect(rows).toHaveLength(1); // never a second transfer
  });

  it('refuses to sign from a non-delegated wallet (no signer call, no record)', async () => {
    await harness.pg.exec('TRUNCATE auth.wallets CASCADE;');
    await seedWallet(false); // embedded but delegation not granted

    await expect(
      executePrivyWithdrawal(
        harness.db,
        { requestId: randomUUID(), userId, destinationWallet: addr(), amountUsdc: '10' },
        { escrowConfig, provider },
      ),
    ).rejects.toMatchObject({ name: 'EmbeddedWalletError', code: 'NOT_DELEGATED' });

    expect(signer.calls).toHaveLength(0);
    expect(await harness.db.select().from(onchainTransfers)).toHaveLength(0);
  });

  it('rejects a withdrawal to the escrow wallet (no signer call, no record)', async () => {
    await expect(
      executePrivyWithdrawal(
        harness.db,
        { requestId: randomUUID(), userId, destinationWallet: escrowConfig.escrowWallet, amountUsdc: '10' },
        { escrowConfig, provider },
      ),
    ).rejects.toThrow();

    expect(signer.calls).toHaveLength(0);
    expect(await harness.db.select().from(onchainTransfers)).toHaveLength(0);
  });

  it('rejects an over-cap amount before signing', async () => {
    await expect(
      executePrivyWithdrawal(
        harness.db,
        { requestId: randomUUID(), userId, destinationWallet: addr(), amountUsdc: '26' },
        { escrowConfig, provider, maxWithdrawUsdc: '25' },
      ),
    ).rejects.toThrow();
    expect(signer.calls).toHaveLength(0);
  });
});

describe('executePrivyWithdrawal — safety guards (mirror the production runner)', () => {
  /** Assert nothing executed: no signer call, no provider transfer, no record. */
  async function expectNoExecution(): Promise<void> {
    expect(signer.calls).toHaveLength(0); // provider → signer never reached
    expect(await harness.db.select().from(onchainTransfers)).toHaveLength(0); // markSubmitted never reached
  }

  it('refuses before signing when withdrawals are frozen', async () => {
    await setFreeze(harness.db, 'withdrawals', true, { actorUserId: null, reason: 'test' });

    await expect(
      executePrivyWithdrawal(
        harness.db,
        { requestId: randomUUID(), userId, destinationWallet: addr(), amountUsdc: '10' },
        { escrowConfig, provider },
      ),
    ).rejects.toMatchObject({ name: 'WithdrawalError', code: 'FROZEN' });

    await expectNoExecution();
  });

  it('refuses before signing when available balance is insufficient', async () => {
    // Funded with 1000; ask for 2000 → balance guard fires before prepare/sign.
    await expect(
      executePrivyWithdrawal(
        harness.db,
        { requestId: randomUUID(), userId, destinationWallet: addr(), amountUsdc: '2000' },
        { escrowConfig, provider },
      ),
    ).rejects.toMatchObject({ name: 'WithdrawalError', code: 'INSUFFICIENT_BALANCE' });

    await expectNoExecution();
  });

  it('refuses before signing when the rolling daily cap is exceeded', async () => {
    await seedPaidWithdrawal('95'); // prior 95 in the last 24h; daily cap is 100

    await expect(
      executePrivyWithdrawal(
        harness.db,
        { requestId: randomUUID(), userId, destinationWallet: addr(), amountUsdc: '10' }, // 95 + 10 > 100
        { escrowConfig, provider },
      ),
    ).rejects.toMatchObject({ name: 'WithdrawalError', code: 'DAILY_CAP_EXCEEDED' });

    await expectNoExecution();
  });

  it('proceeds normally for a valid withdrawal once every guard passes', async () => {
    const result = await executePrivyWithdrawal(
      harness.db,
      { requestId: randomUUID(), userId, destinationWallet: addr(), amountUsdc: '10' },
      { escrowConfig, provider },
    );
    expect(result.created).toBe(true);
    expect(result.transfer.status).toBe('submitted');
    expect(signer.calls).toHaveLength(1); // signed only after the guards passed
  });
});

describe('executePrivyWithdrawal — unified idempotency / single execution', () => {
  /** A Privy provider whose signer fails `failTimes` then succeeds. */
  function flakyProvider(failTimes: number): { provider: PrivySolanaTransferProvider; attempts: () => number } {
    let attempts = 0;
    const flaky: PrivySolanaSigner = {
      signAndSend: () => {
        attempts += 1;
        if (attempts <= failTimes) return Promise.reject(new TransferRetryableError('transient'));
        return Promise.resolve({ txSignature: 'retry-sig' });
      },
    };
    const policy: PrivyTransferPolicy = {
      usdcMint: escrowConfig.usdcMint,
      allowDynamicDestinations: true,
      deniedDestinations: [escrowConfig.escrowWallet],
      maxAmountUsdc: '25',
    };
    return {
      provider: new PrivySolanaTransferProvider({ signer: flaky, policy, caip2: escrowConfig.caip2, feePayer: addr() }),
      attempts: () => attempts,
    };
  }

  it('a duplicate request returns the same transfer without re-signing', async () => {
    const requestId = randomUUID();
    const input = { requestId, userId, destinationWallet: addr(), amountUsdc: '10' };

    const first = await executePrivyWithdrawal(harness.db, input, { escrowConfig, provider });
    const second = await executePrivyWithdrawal(harness.db, input, { escrowConfig, provider });

    expect(second.created).toBe(false);
    expect(second.transfer.id).toBe(first.transfer.id); // same transfer record
    expect(second.txSignature).toBe(first.txSignature); // same signature
    // Duplicate signing + duplicate provider execution + duplicate submit are all
    // impossible: the replay short-circuits before the provider is ever called.
    expect(signer.calls).toHaveLength(1);
    expect(await harness.db.select().from(onchainTransfers)).toHaveLength(1);
    expect(second.transfer.status).toBe('submitted');
  });

  it('the finalized transition can only happen once (guarded)', async () => {
    const result = await executePrivyWithdrawal(
      harness.db,
      { requestId: randomUUID(), userId, destinationWallet: addr(), amountUsdc: '10' },
      { escrowConfig, provider },
    );

    const finalized = await markFinalized(harness.db, result.transfer.id);
    expect(finalized.status).toBe('finalized');

    // A second finalize is rejected by the guarded transition — no double-finalize.
    await expect(markFinalized(harness.db, result.transfer.id)).rejects.toMatchObject({
      name: 'OnchainTransferError',
      code: 'INVALID_TRANSITION',
    });
  });

  it('retries safely: a failed sign leaves the record pending, a retry resumes it', async () => {
    const { provider: fp } = flakyProvider(1);
    const requestId = randomUUID();
    const input = { requestId, userId, destinationWallet: addr(), amountUsdc: '10' };

    // First attempt: the signer fails → the flow throws, leaving a pending record.
    await expect(
      executePrivyWithdrawal(harness.db, input, { escrowConfig, provider: fp }),
    ).rejects.toBeInstanceOf(TransferRetryableError);

    const [afterFail] = await harness.db.select().from(onchainTransfers);
    expect(afterFail?.status).toBe('pending');
    expect(afterFail?.txSignature).toBeNull();

    // Retry: resumes the SAME pending record and completes it — never a 2nd record.
    const retry = await executePrivyWithdrawal(harness.db, input, { escrowConfig, provider: fp });
    expect(retry.created).toBe(false);
    expect(retry.transfer.status).toBe('submitted');
    expect(retry.txSignature).toBe('retry-sig');
    expect(await harness.db.select().from(onchainTransfers)).toHaveLength(1);
  });

  it('concurrent execution stays safe: one record, one signature', async () => {
    const requestId = randomUUID();
    const input = { requestId, userId, destinationWallet: addr(), amountUsdc: '10' };

    const [a, b] = await Promise.all([
      executePrivyWithdrawal(harness.db, input, { escrowConfig, provider }),
      executePrivyWithdrawal(harness.db, input, { escrowConfig, provider }),
    ]);

    // Whatever the interleaving: the unique key + guarded transition + provider
    // idempotency guarantee exactly one execution and one record.
    expect(a.txSignature).toBe(b.txSignature);
    expect(await harness.db.select().from(onchainTransfers)).toHaveLength(1);
  });
});
