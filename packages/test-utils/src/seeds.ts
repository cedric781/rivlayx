import { randomUUID } from 'node:crypto';
import { userRoles, users, type RoleName } from '@rivlayx/db';

export interface TestUser {
  id: string;
  email: string;
  privyId: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

/**
 * Insert a minimal `auth.users` row + a `user` role grant for tests that need
 * a real user_id (e.g. ledger balance updates which FK to auth.users).
 */
export async function createTestUser(
  db: AnyDb,
  opts: { email?: string; roles?: RoleName[] } = {},
): Promise<TestUser> {
  const id = randomUUID();
  const email = opts.email ?? `${id}@test.local`;
  const privyId = `test_${id.replace(/-/g, '').slice(0, 16)}`;
  await db.insert(users).values({
    id,
    email,
    privyId,
    status: 'active',
  });
  const roles = opts.roles ?? ['user'];
  await db.insert(userRoles).values(roles.map((role) => ({ userId: id, role })));
  return { id, email, privyId };
}
