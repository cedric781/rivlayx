import { afterEach, describe, expect, it, vi } from 'vitest';
import type { payouts } from '@rivlayx/core';
import { loadEnv } from '../env';
import { buildTransferProvider, selectProvider } from './provider';

/** Minimal production env (mirrors env.test's prodBase) with an overridable backend. */
const prodEnv = (over: Record<string, string> = {}) =>
  loadEnv({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://u:p@host:5432/db',
    PRIVY_APP_ID: 'prod-app-id',
    NEXT_PUBLIC_PRIVY_APP_ID: 'prod-app-id',
    PRIVY_APP_SECRET: 'prod-app-secret',
    PLATFORM_VAULT_ATA: 'VaultAtaAddressForProd1111111111111111111',
    CRON_SECRET: 'prod-cron-secret-0123456789',
    SOLANA_USDC_MINT: 'DevnetUsdcMintForProd11111111111111111111',
    ...over,
  });

/** Stub delegated signer — never actually invoked in selection tests. */
const stubSigner: payouts.PrivySolanaSigner = {
  signAndSend: () => Promise.resolve({ txSignature: 'stub-sig' }),
};

describe('buildTransferProvider — backend selection', () => {
  afterEach(() => vi.restoreAllMocks());

  it('selects the raw-vault provider when PAYMENT_BACKEND=raw-vault', () => {
    const provider = selectProvider(prodEnv({ PAYMENT_BACKEND: 'raw-vault' }));
    expect(provider.name).toBe('devnet_solana');
  });

  it('defaults to the raw-vault provider when PAYMENT_BACKEND is unset', () => {
    const env = prodEnv();
    expect(env.PAYMENT_BACKEND).toBe('raw-vault');
    expect(selectProvider(env).name).toBe('devnet_solana');
  });

  it('selects the Privy provider when PAYMENT_BACKEND=privy', () => {
    const provider = selectProvider(prodEnv({ PAYMENT_BACKEND: 'privy' }), stubSigner);
    expect(provider.name).toBe('privy');
  });

  it('off-production always returns the deterministic mock regardless of backend', () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      PAYMENT_BACKEND: 'privy',
    });
    expect(selectProvider(env).name).toBe('mock_solana');
  });

  it('buildTransferProvider keeps the underlying provider name through the log decorator', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const provider = buildTransferProvider({ env: prodEnv({ PAYMENT_BACKEND: 'privy' }), privySigner: stubSigner });
    expect(provider.name).toBe('privy');
  });

  it('the logging decorator is transparent: same result, logs the reference', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://u:p@localhost:5432/db' });
    const provider = buildTransferProvider({ env });

    const result = await provider.buildAndSubmitTransfer({
      reference: 'ref-123',
      toWallet: 'DestinationWallet111111111111111111111111',
      amountUsdc: '10',
      betId: 'bet-1',
    });

    expect(result.txSignature).toBeTruthy(); // mock still returns a signature
    const logged = info.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('ref-123'); // reference + idempotency key logged
    expect(logged).toContain('transfer_ok');
  });
});
