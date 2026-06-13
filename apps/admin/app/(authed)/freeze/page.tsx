import { requireSession } from '@rivlayx/auth/next';
import { can } from '@rivlayx/auth';
import { freezeState } from '@rivlayx/db';
import { getDb } from '@/lib/db';
import { AdminShell } from '@/components/admin-shell';
import { StatusBadge } from '@/components/status-badge';
import { ActionButton } from '@/components/action-button';

export const metadata = { title: 'Freeze controls — RivlayX Admin' };

export default async function FreezePage() {
  const { user, roles } = await requireSession(getDb, {
    app: 'admin',
    minRole: 'admin',
    loginPath: '/login',
    mfaPath: '/mfa',
  });
  const db = getDb();
  const rows = await db.select().from(freezeState).orderBy(freezeState.component);

  return (
    <AdminShell user={user} roles={roles}>
      <h1 style={{ margin: 0 }}>Freeze controls</h1>
      <p style={{ opacity: 0.6, marginTop: '0.25rem' }}>
        Per-component kill switches. <code>all</code> overrides every other component when frozen.
      </p>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1.5rem' }}>
        <thead>
          <tr>
            <Th>Component</Th>
            <Th>Status</Th>
            <Th>Last reason</Th>
            <Th>Actions</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const allowed =
              r.component === 'all'
                ? can(roles, 'emergencyFreezeAll')
                : can(roles, 'freezeComponent');
            return (
              <tr key={r.component}>
                <Td>
                  <code>{r.component}</code>
                </Td>
                <Td>
                  <StatusBadge
                    label={r.frozen ? 'FROZEN' : 'OK'}
                    tone={r.frozen ? 'red' : 'green'}
                  />
                </Td>
                <Td style={{ fontSize: 12, opacity: 0.7 }}>{r.reason ?? '—'}</Td>
                <Td>
                  {allowed ? (
                    r.frozen ? (
                      <ActionButton
                        endpoint="/api/admin/freeze"
                        label="Unfreeze"
                        requireReason
                        body={{ component: r.component, frozen: false }}
                        confirmMessage={
                          r.component === 'all'
                            ? 'Lift the emergency freeze? Affects every component.'
                            : `Unfreeze ${r.component}?`
                        }
                      />
                    ) : (
                      <ActionButton
                        endpoint="/api/admin/freeze"
                        label="Freeze"
                        tone="danger"
                        requireReason
                        body={{ component: r.component, frozen: true }}
                        confirmMessage={
                          r.component === 'all'
                            ? 'Emergency-freeze everything? This stops new bets, deposits, settlements, and withdrawals immediately.'
                            : `Freeze ${r.component}? Operations relying on it will start rejecting.`
                        }
                      />
                    )
                  ) : (
                    <span style={{ opacity: 0.5, fontSize: 13 }}>
                      Requires {r.component === 'all' ? 'super_admin' : 'admin'}
                    </span>
                  )}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </AdminShell>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th
      style={{
        textAlign: 'left',
        padding: '0.6rem 0.75rem',
        borderBottom: '1px solid #2c3036',
        fontSize: 11,
        opacity: 0.6,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <td
      style={{
        padding: '0.6rem 0.75rem',
        borderBottom: '1px solid #2c3036',
        fontSize: 13,
        ...style,
      }}
    >
      {children}
    </td>
  );
}
