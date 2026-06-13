import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

describe('apps/admin env validation', () => {
  const valid = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  };

  it('accepts a minimal valid env', () => {
    const env = loadEnv(valid);
    expect(env.NODE_ENV).toBe('test');
    expect(env.PORT).toBe(3001);
  });

  it('rejects missing DATABASE_URL', () => {
    expect(() => loadEnv({ NODE_ENV: 'test' })).toThrow(/DATABASE_URL/);
  });

  it('accepts optional BOOTSTRAP_ADMIN_EMAIL when well-formed', () => {
    const env = loadEnv({ ...valid, BOOTSTRAP_ADMIN_EMAIL: 'admin@rivlayx.com' });
    expect(env.BOOTSTRAP_ADMIN_EMAIL).toBe('admin@rivlayx.com');
  });

  it('rejects malformed BOOTSTRAP_ADMIN_EMAIL', () => {
    expect(() => loadEnv({ ...valid, BOOTSTRAP_ADMIN_EMAIL: 'not-an-email' })).toThrow();
  });

  it('keeps safety brake defaults aligned with apps/web', () => {
    const env = loadEnv(valid);
    expect(env.MAX_BET_USDC).toBe(25);
    expect(env.MAX_TVL_USDC).toBe(1000);
    expect(env.MIN_DEPOSIT_USDC).toBe(5);
    expect(env.MAX_SINGLE_DEPOSIT_USDC).toBe(250);
  });
});
