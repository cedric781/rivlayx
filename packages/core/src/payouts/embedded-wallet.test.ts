import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { Keypair } from '@solana/web3.js';
import { users, wallets } from '@rivlayx/db';
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
  userId?: string;
}
async function seedWallet(w: SeedWallet): Promise<string> {
  const address = w.address ?? addr();
  await harness.db.insert(wallets).values({
    userId: w.userId ?? userId,
    chain: 'solana',
    address,
    source: w.source,
    isPrimary: w.isPrimary ?? false,
    delegated: w.delegated ?? false,
  });
  return address;
}

const revoke = (address: string) =>
  harness.db.update(wallets).set({ delegated: false }).where(eq(wallets.address, address));
const deleteWallet = (address: string) =>
  harness.db.delete(wallets).where(eq(wallets.address, address));
const setUserStatus = (status: 'active' | 'suspended' | 'banned' | 'deleted') =>
  harness.db.update(users).set({ status }).where(eq(users.id, userId));

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

describe('resolveDelegatedEmbeddedWallet — revocation guard', () => {
  it('blocks a wallet whose delegation was revoked', async () => {
    const address = await seedWallet({ source: 'privy_embedded', delegated: true, isPrimary: true });
    expect((await resolveDelegatedEmbeddedWallet(harness.db, userId)).address).toBe(address);

    await revoke(address); // delegation revoked in the database
    await expect(resolveDelegatedEmbeddedWallet(harness.db, userId)).rejects.toMatchObject({
      code: 'NOT_DELEGATED',
    });
  });

  it('is stale-proof: re-reads the database every call (no cached wallet reuse)', async () => {
    const address = await seedWallet({ source: 'privy_embedded', delegated: true, isPrimary: true });
    await resolveDelegatedEmbeddedWallet(harness.db, userId); // first resolve succeeds
    await revoke(address);
    // The second call must NOT reuse the previously-resolved wallet.
    await expect(resolveDelegatedEmbeddedWallet(harness.db, userId)).rejects.toMatchObject({
      code: 'NOT_DELEGATED',
    });
  });

  it('blocks a deleted wallet', async () => {
    const address = await seedWallet({ source: 'privy_embedded', delegated: true, isPrimary: true });
    await deleteWallet(address);
    await expect(resolveDelegatedEmbeddedWallet(harness.db, userId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('resolves the replacement wallet, never the revoked old one', async () => {
    const oldAddr = await seedWallet({ source: 'privy_embedded', delegated: false, isPrimary: false }); // revoked old
    const newAddr = await seedWallet({ source: 'privy_embedded', delegated: true, isPrimary: true }); // replacement
    const resolved = await resolveDelegatedEmbeddedWallet(harness.db, userId);
    expect(resolved.address).toBe(newAddr);
    expect(resolved.address).not.toBe(oldAddr);
  });

  it('fails closed on an ambiguous set of delegated wallets (no safe choice)', async () => {
    await seedWallet({ source: 'privy_embedded', delegated: true, isPrimary: false });
    await seedWallet({ source: 'privy_embedded', delegated: true, isPrimary: false }); // two delegated, no primary
    await expect(resolveDelegatedEmbeddedWallet(harness.db, userId)).rejects.toMatchObject({
      code: 'AMBIGUOUS_WALLET',
    });
  });

  it('never returns another user\'s wallet (ownership)', async () => {
    const other = await createTestUser(harness.db);
    await seedWallet({ source: 'privy_embedded', delegated: true, isPrimary: true, userId: other.id });
    // The current user has no wallet of their own → must NOT borrow the other user's.
    await expect(resolveDelegatedEmbeddedWallet(harness.db, userId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('blocks an inactive (suspended/banned) user', async () => {
    await seedWallet({ source: 'privy_embedded', delegated: true, isPrimary: true });
    await setUserStatus('suspended');
    await expect(resolveDelegatedEmbeddedWallet(harness.db, userId)).rejects.toMatchObject({
      code: 'USER_INACTIVE',
    });
  });

  it('blocks a deleted user', async () => {
    await seedWallet({ source: 'privy_embedded', delegated: true, isPrimary: true });
    await harness.db.delete(users).where(eq(users.id, userId)); // cascades the wallet too
    await expect(resolveDelegatedEmbeddedWallet(harness.db, userId)).rejects.toMatchObject({
      code: 'USER_NOT_FOUND',
    });
  });

  it('duplicate validation + retry are safe (idempotent, read-only)', async () => {
    const address = await seedWallet({ source: 'privy_embedded', delegated: true, isPrimary: true });
    const a = await resolveDelegatedEmbeddedWallet(harness.db, userId);
    const b = await resolveDelegatedEmbeddedWallet(harness.db, userId);
    expect(a).toEqual(b);
    expect(a.address).toBe(address);
    // No side-effects: the row is unchanged after repeated validation.
    const [row] = await harness.db
      .select({ delegated: wallets.delegated })
      .from(wallets)
      .where(eq(wallets.address, address));
    expect(row?.delegated).toBe(true);
  });

  it('a re-granted wallet resolves again (revoke → restore)', async () => {
    const address = await seedWallet({ source: 'privy_embedded', delegated: true, isPrimary: true });
    await revoke(address);
    await expect(resolveDelegatedEmbeddedWallet(harness.db, userId)).rejects.toMatchObject({
      code: 'NOT_DELEGATED',
    });
    await harness.db.update(wallets).set({ delegated: true }).where(eq(wallets.address, address));
    expect((await resolveDelegatedEmbeddedWallet(harness.db, userId)).address).toBe(address);
  });
});
