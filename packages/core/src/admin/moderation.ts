import { and, eq, isNull } from 'drizzle-orm';
import { sessions, users, type User, type UserStatus } from '@rivlayx/db';
import type { LedgerDb } from '../ledger/types';
import { logAdminAction, type AdminAuditEntry } from './audit-log';

export class ModerationError extends Error {
  public readonly code: 'NOT_FOUND' | 'INVALID_TRANSITION' | 'SELF_MODERATION';
  constructor(code: 'NOT_FOUND' | 'INVALID_TRANSITION' | 'SELF_MODERATION', message: string) {
    super(`[${code}] ${message}`);
    this.code = code;
    this.name = 'ModerationError';
  }
}

export interface ModerationInput {
  userId: string;
  actorUserId: string;
  actorRole?: string;
  reason?: string;
  ip?: string | null;
  userAgent?: string | null;
}

export interface ModerationResult {
  user: User;
}

/**
 * Mark a user as `suspended` and revoke all active sessions for them.
 * Reversible via `unsuspendUser`.
 */
export async function suspendUser(db: LedgerDb, input: ModerationInput): Promise<ModerationResult> {
  return doStatusTransition(db, input, 'suspended', 'user.suspend', {
    revokeSessions: true,
    fromAllowed: ['active'],
  });
}

export async function unsuspendUser(
  db: LedgerDb,
  input: ModerationInput,
): Promise<ModerationResult> {
  return doStatusTransition(db, input, 'active', 'user.unsuspend', {
    revokeSessions: false,
    fromAllowed: ['suspended'],
  });
}

export async function banUser(db: LedgerDb, input: ModerationInput): Promise<ModerationResult> {
  return doStatusTransition(db, input, 'banned', 'user.ban', {
    revokeSessions: true,
    fromAllowed: ['active', 'suspended'],
  });
}

export async function unbanUser(db: LedgerDb, input: ModerationInput): Promise<ModerationResult> {
  return doStatusTransition(db, input, 'active', 'user.unban', {
    revokeSessions: false,
    fromAllowed: ['banned'],
  });
}

async function doStatusTransition(
  db: LedgerDb,
  input: ModerationInput,
  toStatus: UserStatus,
  action: string,
  options: {
    revokeSessions: boolean;
    fromAllowed: readonly UserStatus[];
  },
): Promise<ModerationResult> {
  if (input.userId === input.actorUserId) {
    throw new ModerationError('SELF_MODERATION', 'cannot moderate yourself');
  }
  return db.transaction(async (tx: LedgerDb) => {
    const [target] = await tx.select().from(users).where(eq(users.id, input.userId)).limit(1);
    if (!target) throw new ModerationError('NOT_FOUND', `user ${input.userId} not found`);
    if (!options.fromAllowed.includes(target.status)) {
      throw new ModerationError(
        'INVALID_TRANSITION',
        `cannot transition from status=${target.status} via ${action}`,
      );
    }

    const [updated] = await tx
      .update(users)
      .set({ status: toStatus, updatedAt: new Date() })
      .where(eq(users.id, input.userId))
      .returning();
    if (!updated) {
      throw new ModerationError('NOT_FOUND', 'failed to update user');
    }

    if (options.revokeSessions) {
      await tx
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.userId, input.userId), isNull(sessions.revokedAt)));
    }

    const auditEntry: AdminAuditEntry = {
      actorUserId: input.actorUserId,
      actorRole: input.actorRole ?? null,
      action,
      targetType: 'user',
      targetId: input.userId,
      reason: input.reason ?? null,
      metadata: { previousStatus: target.status, newStatus: toStatus },
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    };
    await logAdminAction(tx, auditEntry);

    return { user: updated };
  });
}
