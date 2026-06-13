import { adminAuditLog, type NewAdminAuditLog } from '@rivlayx/db';
import type { LedgerDb } from '../ledger/types';

export interface AdminAuditEntry {
  actorUserId: string;
  /** Human-readable role label captured at action time (e.g. 'super_admin'). */
  actorRole?: string | null;
  /** Dot-namespaced action label — `user.suspend`, `freeze.set`, `dispute.rule`. */
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Append an admin action to `auth.admin_audit_log`. Always runs inside the
 * caller's transaction so the action and its log row commit together — if the
 * action rolls back, no audit ghost remains.
 */
export async function logAdminAction(tx: LedgerDb, entry: AdminAuditEntry): Promise<void> {
  const row: NewAdminAuditLog = {
    actorUserId: entry.actorUserId,
    actorRole: entry.actorRole ?? null,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    reason: entry.reason ?? null,
    metadata: entry.metadata ?? null,
    ip: entry.ip ?? null,
    userAgent: entry.userAgent ?? null,
  };
  await tx.insert(adminAuditLog).values(row);
}
