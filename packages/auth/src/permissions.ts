import type { RoleName } from '@rivlayx/db';
import { hasMinRole } from './roles';

/**
 * Action-level permission predicates. Single source of truth for "who can do
 * what" across admin operations. Each admin route + UI component calls into
 * this map rather than re-implementing role checks ad hoc.
 *
 *   MODERATOR   — disputes + evidence (read-only)
 *   ADMIN       — operations, disputes, moderation, freeze (per-component)
 *   SUPER_ADMIN — everything (incl. emergency freeze + role management)
 */
export const ADMIN_PERMISSIONS = {
  // Disputes
  viewDisputes: (roles: readonly RoleName[]) => hasMinRole(roles, 'moderator'),
  ruleDispute: (roles: readonly RoleName[]) => hasMinRole(roles, 'admin'),

  // Evidence
  viewEvidence: (roles: readonly RoleName[]) => hasMinRole(roles, 'moderator'),

  // Bets
  viewBets: (roles: readonly RoleName[]) => hasMinRole(roles, 'moderator'),
  voidBet: (roles: readonly RoleName[]) => hasMinRole(roles, 'admin'),

  // Users + moderation
  viewUsers: (roles: readonly RoleName[]) => hasMinRole(roles, 'admin'),
  suspendUser: (roles: readonly RoleName[]) => hasMinRole(roles, 'admin'),
  unsuspendUser: (roles: readonly RoleName[]) => hasMinRole(roles, 'admin'),
  banUser: (roles: readonly RoleName[]) => hasMinRole(roles, 'admin'),
  unbanUser: (roles: readonly RoleName[]) => hasMinRole(roles, 'admin'),

  // Financial operations
  viewLedger: (roles: readonly RoleName[]) => hasMinRole(roles, 'admin'),
  viewDeposits: (roles: readonly RoleName[]) => hasMinRole(roles, 'admin'),
  viewReconciliation: (roles: readonly RoleName[]) => hasMinRole(roles, 'admin'),
  approveWithdrawal: (roles: readonly RoleName[]) => hasMinRole(roles, 'admin'),

  // Freeze controls
  freezeComponent: (roles: readonly RoleName[]) => hasMinRole(roles, 'admin'),
  emergencyFreezeAll: (roles: readonly RoleName[]) => hasMinRole(roles, 'super_admin'),

  // Audit log access
  viewAdminAuditLog: (roles: readonly RoleName[]) => hasMinRole(roles, 'admin'),
  viewFullAuditLog: (roles: readonly RoleName[]) => hasMinRole(roles, 'super_admin'),

  // Role management
  manageRoles: (roles: readonly RoleName[]) => hasMinRole(roles, 'super_admin'),
} as const;

export type AdminPermission = keyof typeof ADMIN_PERMISSIONS;

/** True when the caller's role set permits the named action. */
export function can(roles: readonly RoleName[], permission: AdminPermission): boolean {
  return ADMIN_PERMISSIONS[permission](roles);
}

/**
 * Actions that require MFA to be verified on the session before they can
 * proceed. Used by admin API routes as an explicit gate in addition to the
 * session-level MFA check.
 */
export const MFA_REQUIRED_ACTIONS: ReadonlySet<AdminPermission> = new Set<AdminPermission>([
  'ruleDispute',
  'voidBet',
  'suspendUser',
  'unsuspendUser',
  'banUser',
  'unbanUser',
  'freezeComponent',
  'emergencyFreezeAll',
  'manageRoles',
  'approveWithdrawal',
]);

export function requiresMfaForAction(permission: AdminPermission): boolean {
  return MFA_REQUIRED_ACTIONS.has(permission);
}
