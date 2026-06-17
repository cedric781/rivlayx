import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

describe('apps/web env validation', () => {
  const valid = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  };

  it('accepts a minimal valid env', () => {
    const env = loadEnv(valid);
    expect(env.NODE_ENV).toBe('test');
    expect(env.MAX_BET_USDC).toBe(25);
    expect(env.MAX_TVL_USDC).toBe(1000);
  });

  it('rejects missing DATABASE_URL', () => {
    expect(() => loadEnv({ NODE_ENV: 'test' })).toThrow(/DATABASE_URL/);
  });

  it('rejects malformed DATABASE_URL', () => {
    expect(() => loadEnv({ ...valid, DATABASE_URL: 'not-a-url' })).toThrow();
  });

  it('coerces numeric safety brakes from strings', () => {
    const env = loadEnv({ ...valid, MAX_BET_USDC: '50', MAX_TVL_USDC: '2500' });
    expect(env.MAX_BET_USDC).toBe(50);
    expect(env.MAX_TVL_USDC).toBe(2500);
  });

  it('rejects non-positive safety brakes', () => {
    expect(() => loadEnv({ ...valid, MAX_BET_USDC: '0' })).toThrow();
    expect(() => loadEnv({ ...valid, MAX_TVL_USDC: '-1' })).toThrow();
  });

  it('rejects fractional safety brakes', () => {
    expect(() => loadEnv({ ...valid, MAX_BET_USDC: '12.5' })).toThrow();
  });

  it('defaults deposit caps to 5 and 250', () => {
    const env = loadEnv(valid);
    expect(env.MIN_DEPOSIT_USDC).toBe(5);
    expect(env.MAX_SINGLE_DEPOSIT_USDC).toBe(250);
  });

  it('coerces deposit caps from strings', () => {
    const env = loadEnv({ ...valid, MIN_DEPOSIT_USDC: '10', MAX_SINGLE_DEPOSIT_USDC: '500' });
    expect(env.MIN_DEPOSIT_USDC).toBe(10);
    expect(env.MAX_SINGLE_DEPOSIT_USDC).toBe(500);
  });

  it('rejects non-positive deposit caps', () => {
    expect(() => loadEnv({ ...valid, MIN_DEPOSIT_USDC: '0' })).toThrow();
    expect(() => loadEnv({ ...valid, MAX_SINGLE_DEPOSIT_USDC: '-1' })).toThrow();
  });

  it('defaults SOLANA_NETWORK to devnet', () => {
    const env = loadEnv(valid);
    expect(env.SOLANA_NETWORK).toBe('devnet');
  });

  it('accepts SOLANA_NETWORK=mainnet-beta', () => {
    const env = loadEnv({ ...valid, SOLANA_NETWORK: 'mainnet-beta' });
    expect(env.SOLANA_NETWORK).toBe('mainnet-beta');
  });

  it('rejects unknown SOLANA_NETWORK', () => {
    expect(() => loadEnv({ ...valid, SOLANA_NETWORK: 'localnet' })).toThrow();
  });

  it('allows missing Privy keys outside production', () => {
    expect(() => loadEnv({ ...valid })).not.toThrow();
  });

  it('requires Privy keys + vault ATA in production', () => {
    const prod = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://u:p@host:5432/db',
    };
    expect(() => loadEnv(prod)).toThrow(/PRIVY_APP_ID/);
  });

  it('accepts production env with all required keys present', () => {
    const env = loadEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://u:p@host:5432/db',
      PRIVY_APP_ID: 'prod-app-id',
      NEXT_PUBLIC_PRIVY_APP_ID: 'prod-app-id',
      PRIVY_APP_SECRET: 'prod-app-secret',
      PLATFORM_VAULT_ATA: 'VaultAtaAddressForProd1111111111111111111',
      CRON_SECRET: 'prod-cron-secret-0123456789',
      SOLANA_USDC_MINT: 'DevnetUsdcMintForProd11111111111111111111',
    });
    expect(env.PRIVY_APP_ID).toBe('prod-app-id');
    expect(env.PLATFORM_VAULT_ATA).toBe('VaultAtaAddressForProd1111111111111111111');
    expect(env.SOLANA_USDC_MINT).toBe('DevnetUsdcMintForProd11111111111111111111');
  });

  const prodBase = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://u:p@host:5432/db',
    PRIVY_APP_ID: 'prod-app-id',
    NEXT_PUBLIC_PRIVY_APP_ID: 'prod-app-id',
    PRIVY_APP_SECRET: 'prod-app-secret',
    PLATFORM_VAULT_ATA: 'VaultAtaAddressForProd1111111111111111111',
    CRON_SECRET: 'prod-cron-secret-0123456789',
    SOLANA_USDC_MINT: 'DevnetUsdcMintForProd11111111111111111111',
  };

  it('requires CRON_SECRET in production', () => {
    const { CRON_SECRET: _omitCron, ...noCron } = prodBase;
    expect(() => loadEnv(noCron)).toThrow(/CRON_SECRET/);
  });

  it('requires SOLANA_USDC_MINT in production (no mainnet-mint fallback on devnet)', () => {
    const { SOLANA_USDC_MINT: _omitMint, ...noMint } = prodBase;
    expect(() => loadEnv(noMint)).toThrow(/SOLANA_USDC_MINT/);
  });

  it('does NOT require SOLANA_USDC_MINT outside production', () => {
    expect(() => loadEnv(valid)).not.toThrow(); // dev/test use the mock provider
  });
});
