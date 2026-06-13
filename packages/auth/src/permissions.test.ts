import { describe, expect, it } from 'vitest';
import type { RoleName } from '@rivlayx/db';
import { ADMIN_PERMISSIONS, MFA_REQUIRED_ACTIONS, can, requiresMfaForAction } from './permissions';

const userOnly: RoleName[] = ['user'];
const moderator: RoleName[] = ['user', 'moderator'];
const admin: RoleName[] = ['user', 'admin'];
const superAdmin: RoleName[] = ['user', 'super_admin'];

describe('permission matrix — MODERATOR', () => {
  it('can view disputes and evidence (read-only)', () => {
    expect(can(moderator, 'viewDisputes')).toBe(true);
    expect(can(moderator, 'viewEvidence')).toBe(true);
    expect(can(moderator, 'viewBets')).toBe(true);
  });

  it('cannot rule disputes or void bets', () => {
    expect(can(moderator, 'ruleDispute')).toBe(false);
    expect(can(moderator, 'voidBet')).toBe(false);
  });

  it('cannot moderate users, view ledger, or freeze', () => {
    expect(can(moderator, 'suspendUser')).toBe(false);
    expect(can(moderator, 'banUser')).toBe(false);
    expect(can(moderator, 'viewLedger')).toBe(false);
    expect(can(moderator, 'freezeComponent')).toBe(false);
  });
});

describe('permission matrix — ADMIN', () => {
  it('can do everything MODERATOR can', () => {
    expect(can(admin, 'viewDisputes')).toBe(true);
    expect(can(admin, 'viewEvidence')).toBe(true);
  });

  it('can rule disputes + void bets + moderate users', () => {
    expect(can(admin, 'ruleDispute')).toBe(true);
    expect(can(admin, 'voidBet')).toBe(true);
    expect(can(admin, 'suspendUser')).toBe(true);
    expect(can(admin, 'unsuspendUser')).toBe(true);
    expect(can(admin, 'banUser')).toBe(true);
    expect(can(admin, 'unbanUser')).toBe(true);
  });

  it('can freeze components but NOT emergency-freeze all', () => {
    expect(can(admin, 'freezeComponent')).toBe(true);
    expect(can(admin, 'emergencyFreezeAll')).toBe(false);
  });

  it('cannot manage roles', () => {
    expect(can(admin, 'manageRoles')).toBe(false);
  });

  it('can view ledger + deposits + reconciliation', () => {
    expect(can(admin, 'viewLedger')).toBe(true);
    expect(can(admin, 'viewDeposits')).toBe(true);
    expect(can(admin, 'viewReconciliation')).toBe(true);
  });
});

describe('permission matrix — SUPER_ADMIN', () => {
  it('can do everything', () => {
    for (const key of Object.keys(ADMIN_PERMISSIONS) as Array<keyof typeof ADMIN_PERMISSIONS>) {
      expect(can(superAdmin, key)).toBe(true);
    }
  });
});

describe('permission matrix — USER (denied)', () => {
  it('cannot perform any admin permission', () => {
    for (const key of Object.keys(ADMIN_PERMISSIONS) as Array<keyof typeof ADMIN_PERMISSIONS>) {
      expect(can(userOnly, key)).toBe(false);
    }
  });

  it('cannot perform any admin permission when role list is empty', () => {
    for (const key of Object.keys(ADMIN_PERMISSIONS) as Array<keyof typeof ADMIN_PERMISSIONS>) {
      expect(can([], key)).toBe(false);
    }
  });
});

describe('MFA gating', () => {
  it('marks every mutating admin action as MFA-required', () => {
    expect(requiresMfaForAction('ruleDispute')).toBe(true);
    expect(requiresMfaForAction('voidBet')).toBe(true);
    expect(requiresMfaForAction('suspendUser')).toBe(true);
    expect(requiresMfaForAction('banUser')).toBe(true);
    expect(requiresMfaForAction('freezeComponent')).toBe(true);
    expect(requiresMfaForAction('emergencyFreezeAll')).toBe(true);
    expect(requiresMfaForAction('manageRoles')).toBe(true);
  });

  it('does not require MFA for read-only views', () => {
    expect(requiresMfaForAction('viewDisputes')).toBe(false);
    expect(requiresMfaForAction('viewEvidence')).toBe(false);
    expect(requiresMfaForAction('viewBets')).toBe(false);
    expect(requiresMfaForAction('viewUsers')).toBe(false);
    expect(requiresMfaForAction('viewLedger')).toBe(false);
    expect(requiresMfaForAction('viewAdminAuditLog')).toBe(false);
  });

  it('MFA_REQUIRED_ACTIONS contains expected set', () => {
    expect(MFA_REQUIRED_ACTIONS.size).toBeGreaterThanOrEqual(7);
  });
});
