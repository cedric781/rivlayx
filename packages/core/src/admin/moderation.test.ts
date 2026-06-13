import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, isNotNull } from 'drizzle-orm';
import { adminAuditLog, sessions, users } from '@rivlayx/db';
import { createTestDb, createTestUser, type TestDb } from '@rivlayx/test-utils';
import { createSession } from '@rivlayx/auth';
import { ModerationError, banUser, suspendUser, unbanUser, unsuspendUser } from './moderation';

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

async function setupActorAndTarget() {
  const actor = await createTestUser(harness.db, { roles: ['user', 'admin'] });
  const target = await createTestUser(harness.db);
  return { actor, target };
}

describe('suspendUser', () => {
  it('sets status=suspended, revokes active sessions, writes audit row', async () => {
    const { actor, target } = await setupActorAndTarget();
    // Create an active session for target
    await createSession(harness.db, { userId: target.id, app: 'user' });

    const result = await suspendUser(harness.db, {
      userId: target.id,
      actorUserId: actor.id,
      actorRole: 'admin',
      reason: 'spam reports',
      ip: '203.0.113.1',
      userAgent: 'curl/8.0',
    });
    expect(result.user.status).toBe('suspended');

    const revoked = await harness.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, target.id), isNotNull(sessions.revokedAt)));
    expect(revoked).toHaveLength(1);

    const [audit] = await harness.db
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.action, 'user.suspend'));
    expect(audit?.actorUserId).toBe(actor.id);
    expect(audit?.targetId).toBe(target.id);
    expect(audit?.reason).toBe('spam reports');
    expect(audit?.ip).toBe('203.0.113.1');
  });

  it('refuses self-moderation', async () => {
    const actor = await createTestUser(harness.db, { roles: ['user', 'admin'] });
    await expect(
      suspendUser(harness.db, { userId: actor.id, actorUserId: actor.id }),
    ).rejects.toThrow(ModerationError);
  });

  it('rejects when target is not active', async () => {
    const { actor, target } = await setupActorAndTarget();
    await harness.db.update(users).set({ status: 'banned' }).where(eq(users.id, target.id));
    await expect(
      suspendUser(harness.db, { userId: target.id, actorUserId: actor.id }),
    ).rejects.toThrow(/INVALID_TRANSITION|cannot transition/);
  });

  it('rejects unknown user', async () => {
    const actor = await createTestUser(harness.db, { roles: ['user', 'admin'] });
    await expect(
      suspendUser(harness.db, {
        userId: '00000000-0000-0000-0000-000000000000',
        actorUserId: actor.id,
      }),
    ).rejects.toThrow(/NOT_FOUND/);
  });
});

describe('unsuspendUser', () => {
  it('returns suspended user to active without touching sessions', async () => {
    const { actor, target } = await setupActorAndTarget();
    await harness.db.update(users).set({ status: 'suspended' }).where(eq(users.id, target.id));
    const result = await unsuspendUser(harness.db, {
      userId: target.id,
      actorUserId: actor.id,
    });
    expect(result.user.status).toBe('active');

    const [audit] = await harness.db
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.action, 'user.unsuspend'));
    expect(audit?.targetId).toBe(target.id);
  });

  it('rejects when target is already active', async () => {
    const { actor, target } = await setupActorAndTarget();
    await expect(
      unsuspendUser(harness.db, { userId: target.id, actorUserId: actor.id }),
    ).rejects.toThrow(/INVALID_TRANSITION/);
  });
});

describe('banUser / unbanUser', () => {
  it('banUser works from active and from suspended', async () => {
    const { actor, target } = await setupActorAndTarget();
    const r1 = await banUser(harness.db, { userId: target.id, actorUserId: actor.id });
    expect(r1.user.status).toBe('banned');
    await harness.db.update(users).set({ status: 'active' }).where(eq(users.id, target.id));
    await harness.db.update(users).set({ status: 'suspended' }).where(eq(users.id, target.id));
    const r2 = await banUser(harness.db, { userId: target.id, actorUserId: actor.id });
    expect(r2.user.status).toBe('banned');
  });

  it('unbanUser restores active', async () => {
    const { actor, target } = await setupActorAndTarget();
    await banUser(harness.db, { userId: target.id, actorUserId: actor.id });
    const r = await unbanUser(harness.db, { userId: target.id, actorUserId: actor.id });
    expect(r.user.status).toBe('active');

    const auditRows = await harness.db
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.targetId, target.id));
    expect(auditRows.map((a) => a.action).sort()).toEqual(['user.ban', 'user.unban']);
  });

  it('ban revokes active sessions', async () => {
    const { actor, target } = await setupActorAndTarget();
    await createSession(harness.db, { userId: target.id, app: 'user' });
    await banUser(harness.db, { userId: target.id, actorUserId: actor.id });
    const revoked = await harness.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, target.id), isNotNull(sessions.revokedAt)));
    expect(revoked).toHaveLength(1);
  });
});

describe('logAdminAction integration', () => {
  it('captures actor role, target, metadata for every moderation event', async () => {
    const { actor, target } = await setupActorAndTarget();
    await suspendUser(harness.db, {
      userId: target.id,
      actorUserId: actor.id,
      actorRole: 'super_admin',
      reason: 'test',
    });

    const [audit] = await harness.db
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.targetId, target.id));
    expect(audit?.actorRole).toBe('super_admin');
    expect(audit?.metadata).toMatchObject({ previousStatus: 'active', newStatus: 'suspended' });
  });
});
