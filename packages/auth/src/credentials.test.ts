import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { verifyAdminCredentials } from './credentials';

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

describe('verifyAdminCredentials — admin first factor', () => {
  it('accepts valid credentials and returns the user', async () => {
    const u = await createTestUser(harness.db, {
      email: 'Admin@Rivlayx.test',
      roles: ['super_admin'],
      password: 'correct-admin-password',
    });

    const result = await verifyAdminCredentials(harness.db, {
      email: 'Admin@Rivlayx.test',
      password: 'correct-admin-password',
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user.id).toBe(u.id);
  });

  it('is case-insensitive on the email', async () => {
    await createTestUser(harness.db, {
      email: 'Casey@Rivlayx.test',
      password: 'pw-123456',
    });

    const result = await verifyAdminCredentials(harness.db, {
      email: '  casey@rivlayx.test  ',
      password: 'pw-123456',
    });
    expect(result.ok).toBe(true);
  });

  it('rejects an invalid password', async () => {
    await createTestUser(harness.db, {
      email: 'mod@rivlayx.test',
      password: 'right-password',
    });

    const result = await verifyAdminCredentials(harness.db, {
      email: 'mod@rivlayx.test',
      password: 'wrong-password',
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_credentials' });
  });

  it('rejects an unknown email (no user enumeration leak in the result)', async () => {
    const result = await verifyAdminCredentials(harness.db, {
      email: 'ghost@rivlayx.test',
      password: 'whatever',
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_credentials' });
  });

  it('fails closed for a user with no password set (the old email-only path)', async () => {
    // A provisioned account WITHOUT a password — exactly what email-only login
    // used to wave through. It must now be rejected.
    await createTestUser(harness.db, {
      email: 'legacy@rivlayx.test',
      roles: ['admin'],
      // no password
    });

    const result = await verifyAdminCredentials(harness.db, {
      email: 'legacy@rivlayx.test',
      password: 'anything',
    });
    expect(result).toEqual({ ok: false, reason: 'no_password_set' });
  });

  it('rejects an empty password against a real account', async () => {
    await createTestUser(harness.db, {
      email: 'someone@rivlayx.test',
      password: 'a-real-password',
    });
    const result = await verifyAdminCredentials(harness.db, {
      email: 'someone@rivlayx.test',
      password: '',
    });
    expect(result.ok).toBe(false);
  });
});
