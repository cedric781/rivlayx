import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { users, wallets } from '@rivlayx/db';
import { createTestDb, type TestDb } from '@rivlayx/test-utils';
import { UserBannedError, upsertUserFromIdentity } from './upsert-user';

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

describe('upsertUserFromIdentity', () => {
  it('creates a new user, wallet, and user role grant', async () => {
    const id = await upsertUserFromIdentity(harness.db, {
      externalId: 'did:privy:new-user',
      email: 'alice@example.com',
      walletAddress: 'AliceWallet111111111111111111111111111111',
      walletSource: 'privy_embedded',
    });

    const [user] = await harness.db.select().from(users).where(eq(users.id, id));
    expect(user?.email).toBe('alice@example.com');
    expect(user?.privyId).toBe('did:privy:new-user');

    const [wallet] = await harness.db.select().from(wallets).where(eq(wallets.userId, id));
    expect(wallet?.address).toBe('AliceWallet111111111111111111111111111111');
    expect(wallet?.source).toBe('privy_embedded');
    expect(wallet?.isPrimary).toBe(true);
    // Delegation defaults to off until granted (Phase 1: storage only).
    expect(wallet?.delegated).toBe(false);
    expect(wallet?.delegationGrantedAt).toBeNull();
  });

  it('stamps delegation when the verified identity is delegated', async () => {
    const id = await upsertUserFromIdentity(harness.db, {
      externalId: 'did:privy:delegated',
      email: 'dave@example.com',
      walletAddress: 'DaveWallet1111111111111111111111111111111',
      walletSource: 'privy_embedded',
      delegated: true,
    });
    const [wallet] = await harness.db.select().from(wallets).where(eq(wallets.userId, id));
    expect(wallet?.delegated).toBe(true);
    expect(wallet?.delegationGrantedAt).not.toBeNull();
  });

  it('captures delegation on re-link and preserves the original grant timestamp', async () => {
    const id = await upsertUserFromIdentity(harness.db, {
      externalId: 'did:privy:relink-delegated',
      email: 'erin@example.com',
      walletAddress: 'ErinOld111111111111111111111111111111111',
      walletSource: 'privy_embedded',
      delegated: true,
    });
    const [before] = await harness.db.select().from(wallets).where(eq(wallets.userId, id));
    const firstGrant = before!.delegationGrantedAt;

    await upsertUserFromIdentity(harness.db, {
      externalId: 'did:privy:relink-delegated',
      email: 'erin@example.com',
      walletAddress: 'ErinNew111111111111111111111111111111111',
      walletSource: 'privy_embedded',
      delegated: true,
    });
    const [after] = await harness.db.select().from(wallets).where(eq(wallets.userId, id));
    expect(after?.address).toBe('ErinNew111111111111111111111111111111111');
    expect(after?.delegated).toBe(true);
    expect(after?.delegationGrantedAt).toEqual(firstGrant); // COALESCE preserved it
  });

  it('returns existing user_id for a returning Privy DID', async () => {
    const id1 = await upsertUserFromIdentity(harness.db, {
      externalId: 'did:privy:same',
      email: 'bob@example.com',
      walletAddress: 'BobWallet11111111111111111111111111111111',
      walletSource: 'privy_embedded',
    });
    const id2 = await upsertUserFromIdentity(harness.db, {
      externalId: 'did:privy:same',
      email: 'bob@example.com',
      walletAddress: 'BobWallet11111111111111111111111111111111',
      walletSource: 'privy_embedded',
    });
    expect(id2).toBe(id1);

    const allUsers = await harness.db.select().from(users);
    expect(allUsers).toHaveLength(1);
  });

  it('updates the primary wallet when the verified address changes', async () => {
    const id = await upsertUserFromIdentity(harness.db, {
      externalId: 'did:privy:relinker',
      email: 'carol@example.com',
      walletAddress: 'OldAddress11111111111111111111111111111111',
      walletSource: 'privy_embedded',
    });

    await upsertUserFromIdentity(harness.db, {
      externalId: 'did:privy:relinker',
      email: 'carol@example.com',
      walletAddress: 'NewAddress11111111111111111111111111111111',
      walletSource: 'privy_embedded',
    });

    const [wallet] = await harness.db.select().from(wallets).where(eq(wallets.userId, id));
    expect(wallet?.address).toBe('NewAddress11111111111111111111111111111111');
  });

  it('throws UserBannedError for an inactive existing account', async () => {
    const id = await upsertUserFromIdentity(harness.db, {
      externalId: 'did:privy:banned',
      email: 'banned@example.com',
      walletAddress: 'BannedWallet11111111111111111111111111111',
      walletSource: 'privy_embedded',
    });
    await harness.db.update(users).set({ status: 'banned' }).where(eq(users.id, id));

    await expect(
      upsertUserFromIdentity(harness.db, {
        externalId: 'did:privy:banned',
        email: 'banned@example.com',
        walletAddress: 'BannedWallet11111111111111111111111111111',
        walletSource: 'privy_embedded',
      }),
    ).rejects.toThrow(UserBannedError);
  });
});
