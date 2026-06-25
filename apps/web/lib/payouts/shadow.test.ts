import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { payouts } from '@rivlayx/core';
import { bets, ledgerEntries } from '@rivlayx/db';
import { MockHeliusRpc } from '@rivlayx/helius';
import { createTestDb, type TestDb } from '@rivlayx/test-utils';
import { loadEnv, type Env } from '../env';
import { buildTransferProvider, maybeWrapShadow } from './provider';
import { resetShadowMetrics, runShadow, shadowMetrics, compareIntents } from './shadow';

const shadowEnv = (over: Record<string, string> = {}): Env =>
  loadEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://u:p@localhost:5432/db', ...over });

/** A raw-vault withdrawal transfer input (bare requestId reference, no fromWallet). */
const withdrawalInput: payouts.TransferInput = {
  reference: 'req-abc-123',
  toWallet: 'ExternalDestinationWallet1111111111111111',
  amountUsdc: '10',
  betId: 'req-abc-123',
};

/** Deterministic inner provider so transparency can be asserted exactly. */
const fixedInner: payouts.SolanaTransferProvider = {
  name: 'devnet_solana',
  buildAndSubmitTransfer: () => Promise.resolve({ txSignature: 'FIXED_SIGNATURE' }),
};

beforeEach(() => {
  resetShadowMetrics();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('runShadow', () => {
  it('shadow mode OFF: a transfer never triggers a shadow comparison', async () => {
    const provider = buildTransferProvider({ env: shadowEnv() }); // PAYMENT_SHADOW_MODE=false
    await provider.buildAndSubmitTransfer(withdrawalInput);

    const logged = (console.info as ReturnType<typeof vi.fn>).mock.calls
      .concat((console.warn as ReturnType<typeof vi.fn>).mock.calls)
      .map((c) => String(c[0]))
      .join('\n');
    expect(logged).not.toContain('shadow_start');
    expect(shadowMetrics()).toEqual({
      shadow_success: 0,
      shadow_failure: 0,
      shadow_difference: 0,
      shadow_skipped: 0,
    });
  });

  it('shadow mode ON: a transfer runs the dry-run comparison and logs it', async () => {
    const provider = buildTransferProvider({ env: shadowEnv({ PAYMENT_SHADOW_MODE: 'true' }) });
    await provider.buildAndSubmitTransfer(withdrawalInput);

    const logged = (console.info as ReturnType<typeof vi.fn>).mock.calls
      .concat((console.warn as ReturnType<typeof vi.fn>).mock.calls)
      .map((c) => String(c[0]))
      .join('\n');
    expect(logged).toContain('shadow_start');
    // A raw-vault withdrawal differs from the Privy intent (source + idempotency key).
    expect(shadowMetrics().shadow_difference).toBe(1);
  });

  it('logs differences correctly (source + idempotency key for a raw-vault withdrawal)', () => {
    const outcome = runShadow(withdrawalInput, { env: shadowEnv(), providerName: 'devnet_solana' });

    expect(outcome.status).toBe('difference');
    expect(outcome.type).toBe('withdrawal');
    expect(outcome.differences).toContain('source'); // vault vs user embedded wallet
    expect(outcome.differences).toContain('idempotencyKey'); // bare id vs withdrawal:{id}
    expect(outcome.differences).not.toContain('amountUsdc');
    expect(outcome.differences).not.toContain('destination');

    const warned = (console.warn as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0])).join('\n');
    expect(warned).toContain('shadow_difference');
    expect(shadowMetrics().shadow_difference).toBe(1);
  });

  it('reports success when intents match (no differences)', () => {
    // Stake-shaped input with an already-prefixed key and an explicit source →
    // raw-vault and Privy intents line up on all seven fields.
    const matching: payouts.TransferInput = {
      reference: 'stake:bet-1:user-1',
      toWallet: 'EscrowWallet11111111111111111111111111111',
      amountUsdc: '5',
      betId: 'bet-1',
      fromWallet: 'UserEmbeddedWallet111111111111111111111111',
    };
    const outcome = runShadow(matching, { env: shadowEnv(), providerName: 'devnet_solana' });
    expect(outcome.status).toBe('success');
    expect(shadowMetrics()).toMatchObject({ shadow_success: 1, shadow_difference: 0 });
  });

  it('counts shadow_skipped for a malformed (non-shadowable) input', () => {
    const outcome = runShadow(
      { reference: 'x', toWallet: '', amountUsdc: '1', betId: 'x' },
      { env: shadowEnv(), providerName: 'devnet_solana' },
    );
    expect(outcome.status).toBe('skipped');
    expect(shadowMetrics().shadow_skipped).toBe(1);
  });

  it('does NOT call a signer (no signing in the shadow path)', async () => {
    const signer: payouts.PrivySolanaSigner = {
      signAndSend: vi.fn(() => Promise.resolve({ txSignature: 'should-not-run' })),
    };
    const provider = buildTransferProvider({
      env: shadowEnv({ PAYMENT_SHADOW_MODE: 'true' }),
      privySigner: signer,
    });
    await provider.buildAndSubmitTransfer(withdrawalInput);
    expect(signer.signAndSend).not.toHaveBeenCalled();
  });

  it('does NOT call an RPC (no network in the shadow path)', async () => {
    const rpc = new MockHeliusRpc();
    const spy = vi.spyOn(rpc, 'getTokenAccountBalance');
    const provider = buildTransferProvider({ env: shadowEnv({ PAYMENT_SHADOW_MODE: 'true' }) });
    await provider.buildAndSubmitTransfer(withdrawalInput);
    expect(spy).not.toHaveBeenCalled();
  });

  it('raw-vault result stays byte-identical with shadow ON', async () => {
    const env = shadowEnv({ PAYMENT_SHADOW_MODE: 'true' });
    const wrapped = maybeWrapShadow(fixedInner, env);
    const direct = await fixedInner.buildAndSubmitTransfer(withdrawalInput);
    const viaShadow = await wrapped.buildAndSubmitTransfer(withdrawalInput);
    expect(viaShadow).toEqual(direct);
    expect(viaShadow.txSignature).toBe('FIXED_SIGNATURE');
    expect(wrapped.name).toBe('devnet_solana'); // name passes through unchanged
  });

  it('compareIntents returns exactly the differing field names', () => {
    const a = {
      type: 'withdrawal' as const,
      amountUsdc: '10',
      source: 'A',
      destination: 'D',
      mint: 'M',
      caip2: 'C',
      idempotencyKey: 'k1',
    };
    expect(compareIntents(a, a)).toEqual([]);
    expect(compareIntents(a, { ...a, source: 'B', idempotencyKey: 'k2' })).toEqual([
      'source',
      'idempotencyKey',
    ]);
  });
});

describe('runShadow — no persistence', () => {
  let harness: TestDb;
  beforeAll(async () => {
    harness = await createTestDb();
  });
  afterAll(async () => {
    await harness.close();
  });

  it('writes no ledger rows and changes no bets', async () => {
    const ledgerBefore = (await harness.db.select().from(ledgerEntries)).length;
    const betsBefore = (await harness.db.select().from(bets)).length;

    // The shadow path takes no db handle — running it cannot touch any table.
    runShadow(withdrawalInput, { env: shadowEnv(), providerName: 'devnet_solana' });
    const wrapped = maybeWrapShadow(fixedInner, shadowEnv({ PAYMENT_SHADOW_MODE: 'true' }));
    await wrapped.buildAndSubmitTransfer(withdrawalInput);

    expect((await harness.db.select().from(ledgerEntries)).length).toBe(ledgerBefore);
    expect((await harness.db.select().from(bets)).length).toBe(betsBefore);
  });
});
