import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { wallets } from '@rivlayx/db';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { getUserEmbeddedWallet } from './embedded';

let harness: TestDb;

beforeAll(async () => {
  harness = await createTestDb();
});
afterAll(async () => {
  await harness.close();
});
beforeEach(async () => {
  await harness.pg.exec('TRUNCATE auth.users CASCADE;');
});

const ADDR = 'EmbeddedWallet1111111111111111111111111111';

describe('getUserEmbeddedWallet', () => {
  it('returns the primary privy_embedded Solana wallet', async () => {
    const user = await createTestUser(harness.db);
    await harness.db.insert(wallets).values({
      userId: user.id,
      chain: 'solana',
      address: ADDR,
      source: 'privy_embedded',
      isPrimary: true,
      delegated: true,
      delegationGrantedAt: new Date('2026-06-01T00:00:00Z'),
    });

    const w = await getUserEmbeddedWallet(harness.db, user.id);
    expect(w).not.toBeNull();
    expect(w?.address).toBe(ADDR);
    expect(w?.delegated).toBe(true);
    expect(w?.delegationGrantedAt).toEqual(new Date('2026-06-01T00:00:00Z'));
  });

  it('returns null when the user has no embedded wallet', async () => {
    const user = await createTestUser(harness.db);
    expect(await getUserEmbeddedWallet(harness.db, user.id)).toBeNull();
  });

  it('ignores non-embedded and non-primary wallets', async () => {
    const user = await createTestUser(harness.db);
    await harness.db.insert(wallets).values([
      {
        userId: user.id,
        chain: 'solana',
        address: 'ExternalLinked11111111111111111111111111111',
        source: 'external_linked',
        isPrimary: false,
      },
    ]);
    expect(await getUserEmbeddedWallet(harness.db, user.id)).toBeNull();
  });

  it('throws when more than one primary embedded wallet exists (invariant)', async () => {
    const user = await createTestUser(harness.db);
    await harness.db.insert(wallets).values([
      {
        userId: user.id,
        chain: 'solana',
        address: ADDR,
        source: 'privy_embedded',
        isPrimary: true,
      },
      {
        userId: user.id,
        chain: 'solana',
        address: 'EmbeddedWallet2222222222222222222222222222',
        source: 'privy_embedded',
        isPrimary: true,
      },
    ]);
    await expect(getUserEmbeddedWallet(harness.db, user.id)).rejects.toThrow(/invariant/);
  });

  it('defaults delegated to false when not granted', async () => {
    const user = await createTestUser(harness.db);
    await harness.db.insert(wallets).values({
      userId: user.id,
      chain: 'solana',
      address: ADDR,
      source: 'privy_embedded',
      isPrimary: true,
    });
    const w = await getUserEmbeddedWallet(harness.db, user.id);
    expect(w?.delegated).toBe(false);
    expect(w?.delegationGrantedAt).toBeNull();
  });
});
