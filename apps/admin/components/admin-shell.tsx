import Link from 'next/link';
import type { ReactNode } from 'react';
import type { RoleName } from '@rivlayx/db';
import { can, type AdminPermission } from '@rivlayx/auth';

export interface AdminShellProps {
  user: { email: string };
  roles: RoleName[];
  children: ReactNode;
}

const navItems: Array<{ href: string; label: string; permission: AdminPermission }> = [
  { href: '/dashboard', label: 'Dashboard', permission: 'viewDisputes' },
  { href: '/disputes', label: 'Disputes', permission: 'viewDisputes' },
  { href: '/bets', label: 'Bets', permission: 'viewBets' },
  { href: '/users', label: 'Users', permission: 'viewUsers' },
  { href: '/reputation', label: 'Reputation', permission: 'viewUsers' },
  { href: '/risk', label: 'Risk', permission: 'viewUsers' },
  { href: '/evidence', label: 'Evidence', permission: 'viewEvidence' },
  { href: '/finance', label: 'Finance', permission: 'viewLedger' },
  { href: '/auto-resolve', label: 'Auto resolve', permission: 'viewBets' },
  { href: '/payouts', label: 'Payouts', permission: 'viewLedger' },
  { href: '/freeze', label: 'Freeze', permission: 'freezeComponent' },
  { href: '/audit-log', label: 'Audit log', permission: 'viewAdminAuditLog' },
];

export function AdminShell({ user, roles, children }: AdminShellProps) {
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <aside
        style={{
          width: 220,
          background: '#13161a',
          borderRight: '1px solid #2c3036',
          padding: '1.5rem 0',
        }}
      >
        <div style={{ padding: '0 1.5rem 1rem' }}>
          <div
            style={{ fontSize: 11, opacity: 0.5, textTransform: 'uppercase', letterSpacing: 0.4 }}
          >
            Signed in
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4, wordBreak: 'break-all' }}>
            {user.email}
          </div>
          <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>{roles.join(' · ')}</div>
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column' }}>
          {navItems
            .filter((item) => can(roles, item.permission))
            .map((item) => (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  padding: '0.6rem 1.5rem',
                  color: '#e6e8eb',
                  textDecoration: 'none',
                  fontSize: 14,
                }}
              >
                {item.label}
              </Link>
            ))}
        </nav>
      </aside>
      <main style={{ flex: 1, padding: '2rem 2.5rem' }}>{children}</main>
    </div>
  );
}
