import { describe, expect, it } from 'vitest';
import {
  hasMinRole,
  highestRole,
  isAdminAppRole,
  mfaRequiredRoles,
  requiresMfa,
  roleOrder,
  rolePrivilegeLevel,
} from './roles';

describe('role hierarchy', () => {
  it('orders roles correctly', () => {
    expect(roleOrder).toEqual(['user', 'moderator', 'admin', 'super_admin']);
    expect(rolePrivilegeLevel('user')).toBe(0);
    expect(rolePrivilegeLevel('super_admin')).toBe(3);
  });

  it('hasMinRole permits higher roles', () => {
    expect(hasMinRole(['admin'], 'moderator')).toBe(true);
    expect(hasMinRole(['super_admin'], 'admin')).toBe(true);
    expect(hasMinRole(['user', 'moderator'], 'admin')).toBe(false);
  });

  it('hasMinRole permits exact role', () => {
    expect(hasMinRole(['moderator'], 'moderator')).toBe(true);
  });

  it('hasMinRole rejects when no role meets bar', () => {
    expect(hasMinRole(['user'], 'moderator')).toBe(false);
    expect(hasMinRole([], 'user')).toBe(false);
  });

  it('highestRole returns the most privileged grant', () => {
    expect(highestRole(['user', 'admin', 'moderator'])).toBe('admin');
    expect(highestRole(['user'])).toBe('user');
    expect(highestRole([])).toBeNull();
  });
});

describe('MFA enforcement', () => {
  it('requires MFA for admin and super_admin', () => {
    expect(mfaRequiredRoles.has('admin')).toBe(true);
    expect(mfaRequiredRoles.has('super_admin')).toBe(true);
    expect(mfaRequiredRoles.has('moderator')).toBe(false);
    expect(mfaRequiredRoles.has('user')).toBe(false);
  });

  it('requiresMfa triggers when any granted role is privileged', () => {
    expect(requiresMfa(['user', 'admin'])).toBe(true);
    expect(requiresMfa(['user', 'moderator'])).toBe(false);
    expect(requiresMfa(['super_admin'])).toBe(true);
    expect(requiresMfa([])).toBe(false);
  });
});

describe('admin-app eligibility', () => {
  it('treats every non-user role as admin-app eligible', () => {
    expect(isAdminAppRole('moderator')).toBe(true);
    expect(isAdminAppRole('admin')).toBe(true);
    expect(isAdminAppRole('super_admin')).toBe(true);
    expect(isAdminAppRole('user')).toBe(false);
  });
});
