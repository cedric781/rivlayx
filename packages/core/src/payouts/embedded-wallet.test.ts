import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { wallets } from '@rivlayx/db';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { EmbeddedWalletError, resolveDelegatedEmbeddedWallet } from './embedded-wallet';

const addr = () => Keypair.generate().publicKey.toBase58();

let harness: TestDb;
let userId: string;

beforeAll(async () => {
  harness = await createTestDb();
});
afterAll(async () => {
  await harness.close();
});
beforeEach(async () => {
  await harness.pg.exec('TRUNCATE auth.users CASCADE;'); // cascades to auth.wallets
  const user = await createTestUser(harness.db);
  userId = user.id;
});

interface SeedWallet {
  source: 'privy_embedded' | 'external_linked' | 'mock_dev';
  delegated?: boolean;
  isPrimary?: boolean;
  address?: string;
}
async function seedWallet(w: SeedWallet): Promise<string> {
  const address = w.address ?? addr();
  await harness.db.insert(wallets).values({
    userId,
    chain: 'solana',
    address,
    source: w.source,
    isPrimary: w.isPrimary ?? false,
    delegated: w.delegated ?? false,
  });
  return address;
}

describe('resolveDelegatedEmbeddedWallet', () => {
  it('resolves a delegated embedded wallet', async () => {
    const address = await seedWallet({ source: 'privy_embedded', delegated: true, isPrimary: true });
    const resolved = await resolveDelegatedEmbeddedWallet(harness.db, userId);
    expect(resolved).toEqual({ address, delegated: true });
  });

  it('prefers the primary embedded wallet among several', async () => {
    await seedWallet({ source: 'privy_embedded', delegated: true, isPrimary: false });
    const primary = await seedWallet({ source: 'privy_embedded', delegated: true, isPrimary: true });
    const resolved = await resolveDelegatedEmbeddedWallet(harness.db, userId);
    expect(resolved.address).toBe(primary);
  });

  it('throws NOT_FOUND when the user has no solana wallet', async () => {
    await expect(resolveDelegatedEmbeddedWallet(harness.db, userId)).rejects.toMatchObject({
      name: 'EmbeddedWalletError',
      code: 'NOT_FOUND',
    });
  });

  it('throws NOT_EMBEDDED when only an external wallet is linked', async () => {
    await seedWallet({ source: 'external_linked', delegated: true, isPrimary: true });
    await expect(resolveDelegatedEmbeddedWallet(harness.db, userId)).rejects.toMatchObject({
      code: 'NOT_EMBEDDED',
    });
  });

  it('throws NOT_DELEGATED when the embedded wallet has not granted delegation', async () => {
    await seedWallet({ source: 'privy_embedded', delegated: false, isPrimary: true });
    const err = await resolveDelegatedEmbeddedWallet(harness.db, userId).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EmbeddedWalletError);
    expect((err as EmbeddedWalletError).code).toBe('NOT_DELEGATED');
  });
});
