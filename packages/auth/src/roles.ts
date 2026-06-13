import type { RoleName } from '@rivlayx/db';

/**
 * Role hierarchy in ascending privilege order. Higher index = more access.
 *
 *   user        → normal app user
 *   moderator   → disputes + content review
 *   admin       → operational access (freeze, payouts monitor)
 *   super_admin → full access (role grants, unfreeze)
 */
export const roleOrder: readonly RoleName[] = [
  'user',
  'moderator',
  'admin',
  'super_admin',
] as const;

export function rolePrivilegeLevel(role: RoleName): number {
  return roleOrder.indexOf(role);
}

export function hasMinRole(grantedRoles: readonly RoleName[], minRole: RoleName): boolean {
  const required = rolePrivilegeLevel(minRole);
  return grantedRoles.some((r) => rolePrivilegeLevel(r) >= required);
}

export function highestRole(grantedRoles: readonly RoleName[]): RoleName | null {
  if (grantedRoles.length === 0) return null;
  let top: RoleName = grantedRoles[0]!;
  for (const r of grantedRoles) {
    if (rolePrivilegeLevel(r) > rolePrivilegeLevel(top)) top = r;
  }
  return top;
}

/**
 * Roles that must complete MFA before any privileged action.
 * Enforced server-side at the session gate.
 */
export const mfaRequiredRoles: ReadonlySet<RoleName> = new Set(['admin', 'super_admin']);

export function requiresMfa(grantedRoles: readonly RoleName[]): boolean {
  return grantedRoles.some((r) => mfaRequiredRoles.has(r));
}

/** Any non-user role is admin-app eligible. */
export function isAdminAppRole(role: RoleName): boolean {
  return role !== 'user';
}
