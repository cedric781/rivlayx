import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { userRoles, users, wallets, type NewUser } from '@rivlayx/db';
import { profiles } from '@rivlayx/core';
import type { VerifiedIdentity } from '@rivlayx/auth';

export class UserBannedError extends Error {
  constructor() {
    super('USER_BANNED');
    this.name = 'UserBannedError';
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/**
 * Upsert an `auth.users` row + primary `auth.wallets` row + initial `user` role
 * grant from a provider's `VerifiedIdentity`. Atomic — wrapped in a Drizzle
 * transaction.
 *
 *   - New `externalId` (privy_id) → create user, wallet, role grant.
 *   - Existing `externalId` + `status='active'` → return existing user_id.
 *     If the verified wallet address differs from the stored one, update the
 *     primary wallet row in place (re-link). This matches the Sprint 5
 *     single-primary-wallet decision.
 *   - Existing `externalId` + status not active → throw `UserBannedError`.
 *
 * The DB type is intentionally loose to accept both production (postgres-js)
 * and the pglite test driver.
 */
export async function upsertUserFromIdentity(db: Db, identity: VerifiedIdentity): Promise<string> {
  return db.transaction(async (tx: Db) => {
    const existing = await tx
      .select({
        id: users.id,
        status: users.status,
        currentAddress: wallets.address,
      })
      .from(users)
      .leftJoin(wallets, eq(wallets.userId, users.id))
      .where(eq(users.privyId, identity.externalId))
      .limit(1);

    if (existing[0]) {
      if (existing[0].status !== 'active') throw new UserBannedError();
      if (existing[0].currentAddress !== identity.walletAddress) {
        await tx
          .update(wallets)
          .set({
            address: identity.walletAddress,
            source: identity.walletSource,
          })
          .where(eq(wallets.userId, existing[0].id));
      }
      return existing[0].id;
    }

    const newId = randomUUID();
    const preferred = identity.email.split('@')[0] ?? 'user';
    const username = await profiles.generateUniqueUsername(tx, preferred);
    const newUser: NewUser = {
      id: newId,
      privyId: identity.externalId,
      email: identity.email,
      username,
      status: 'active',
      mfaRequired: false,
    };
    await tx.insert(users).values(newUser);
    await tx.insert(wallets).values({
      userId: newId,
      chain: 'solana',
      address: identity.walletAddress,
      source: identity.walletSource,
      isPrimary: true,
    });
    await tx.insert(userRoles).values({ userId: newId, role: 'user' });
    return newId;
  });
}
