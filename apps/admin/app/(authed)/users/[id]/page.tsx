import Link from 'next/link';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { requireSession } from '@rivlayx/auth/next';
import { can } from '@rivlayx/auth';
import { formatUsdc } from '@rivlayx/shared';
import { bets, deposits, userRoles, users, wallets } from '@rivlayx/db';
import { ledger } from '@rivlayx/core';
import { getDb } from '@/lib/db';
import { AdminShell } from '@/components/admin-shell';
import { StatusBadge, toneForUserStatus, toneForBetStatus } from '@/components/status-badge';
import { ActionButton } from '@/components/action-button';

export const metadata = { title: 'User — RivlayX Admin' };

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { user: me, roles } = await requireSession(getDb, {
    app: 'admin',
    minRole: 'admin',
    loginPath: '/login',
    mfaPath: '/mfa',
  });
  const { id } = await params;

  const db = getDb();
  const [target] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!target) {
    return (
      <AdminShell user={me} roles={roles}>
        <h1>User not found</h1>
      </AdminShell>
    );
  }

  const targetRolesRows = await db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.userId, target.id));
  const targetRoles = targetRolesRows.map((r) => r.role);

  const userWallets = await db.select().from(wallets).where(eq(wallets.userId, target.id));
  const userDeposits = await db
    .select()
    .from(deposits)
    .where(eq(deposits.userId, target.id))
    .orderBy(desc(deposits.detectedAt))
    .limit(20);
  const activeBets = await db
    .select()
    .from(bets)
    .where(
      and(
        or(eq(bets.creatorUserId, target.id), eq(bets.acceptorUserId, target.id)),
        inArray(bets.status, ['OPEN', 'ACTIVE', 'AWAITING_RESULT', 'DISPUTED']),
      ),
    )
    .orderBy(desc(bets.createdAt))
    .limit(20);
  const balance = await ledger.getBalance(db, target.id);

  const canSuspend = can(roles, 'suspendUser') && target.status === 'active';
  const canUnsuspend = can(roles, 'unsuspendUser') && target.status === 'suspended';
  const canBan =
    can(roles, 'banUser') && (target.status === 'active' || target.status === 'suspended');
  const canUnban = can(roles, 'unbanUser') && target.status === 'banned';
  const isSelf = target.id === me.id;

  return (
    <AdminShell user={me} roles={roles}>
      <div style={{ marginBottom: '1rem' }}>
        <Link href="/users" style={{ color: '#5b8def', fontSize: 13 }}>
          ← Back
        </Link>
      </div>
      <h1 style={{ margin: 0 }}>{target.email}</h1>
      <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: 12 }}>
        <StatusBadge label={target.status} tone={toneForUserStatus(target.status)} />
        <span style={{ opacity: 0.6, fontSize: 13 }}>
          Roles: {targetRoles.join(', ') || 'none'}
        </span>
        <span style={{ opacity: 0.6, fontSize: 12 }}>
          Joined {target.createdAt.toISOString().slice(0, 10)}
        </span>
      </div>

      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: 18 }}>Balance</h2>
        <p>
          Available: <strong>{formatUsdc(balance?.availableUsdc ?? '0')}</strong> — Locked:{' '}
          <strong>{formatUsdc(balance?.lockedUsdc ?? '0')}</strong>
        </p>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: 18 }}>Wallets</h2>
        <ul>
          {userWallets.map((w) => (
            <li key={w.id}>
              <code style={{ wordBreak: 'break-all' }}>{w.address}</code> · {w.source}{' '}
              {w.isPrimary && <strong>(primary)</strong>}
            </li>
          ))}
          {userWallets.length === 0 && <li style={{ opacity: 0.6 }}>No wallets linked.</li>}
        </ul>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: 18 }}>Recent deposits</h2>
        <ul>
          {userDeposits.map((d) => (
            <li key={d.id}>
              {d.detectedAt.toISOString()} · {formatUsdc(d.amountUsdc)} ·{' '}
              <StatusBadge
                label={d.status}
                tone={
                  d.status === 'credited' ? 'green' : d.status === 'rejected' ? 'red' : 'yellow'
                }
              />
            </li>
          ))}
          {userDeposits.length === 0 && <li style={{ opacity: 0.6 }}>None.</li>}
        </ul>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: 18 }}>Active bets</h2>
        <ul>
          {activeBets.map((b) => (
            <li key={b.id}>
              <Link href={`/bets/${b.id}`} style={{ color: '#5b8def', fontFamily: 'monospace' }}>
                {b.shortCode}
              </Link>{' '}
              <StatusBadge label={b.status} tone={toneForBetStatus(b.status)} /> · stake{' '}
              {formatUsdc(b.stakePerSideUsdc)}
            </li>
          ))}
          {activeBets.length === 0 && <li style={{ opacity: 0.6 }}>None.</li>}
        </ul>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: 18 }}>Moderation</h2>
        {isSelf && (
          <p style={{ opacity: 0.6, fontSize: 13 }}>You cannot moderate your own account.</p>
        )}
        {!isSelf && (
          <div>
            {canSuspend && (
              <ActionButton
                endpoint={`/api/admin/users/${target.id}/suspend`}
                label="Suspend"
                requireReason
                confirmMessage="Suspend this user? They will be logged out and unable to sign in."
              />
            )}
            {canUnsuspend && (
              <ActionButton
                endpoint={`/api/admin/users/${target.id}/unsuspend`}
                label="Unsuspend"
                confirmMessage="Restore this user to active?"
              />
            )}
            {canBan && (
              <ActionButton
                endpoint={`/api/admin/users/${target.id}/ban`}
                label="Ban"
                tone="danger"
                requireReason
                confirmMessage="Ban this user? They will be logged out and unable to sign in."
              />
            )}
            {canUnban && (
              <ActionButton
                endpoint={`/api/admin/users/${target.id}/unban`}
                label="Unban"
                confirmMessage="Restore this user to active?"
              />
            )}
          </div>
        )}
      </section>
    </AdminShell>
  );
}
