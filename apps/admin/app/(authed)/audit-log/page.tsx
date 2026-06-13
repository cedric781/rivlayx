import { desc, eq } from 'drizzle-orm';
import { requireSession } from '@rivlayx/auth/next';
import { adminAuditLog, users } from '@rivlayx/db';
import { getDb } from '@/lib/db';
import { AdminShell } from '@/components/admin-shell';

export const metadata = { title: 'Audit log — RivlayX Admin' };

const PAGE_SIZE = 200;

export default async function AuditLogPage() {
  const { user, roles } = await requireSession(getDb, {
    app: 'admin',
    minRole: 'admin',
    loginPath: '/login',
    mfaPath: '/mfa',
  });
  const db = getDb();
  const rows = await db
    .select({ a: adminAuditLog, actor: { email: users.email } })
    .from(adminAuditLog)
    .leftJoin(users, eq(users.id, adminAuditLog.actorUserId))
    .orderBy(desc(adminAuditLog.at))
    .limit(PAGE_SIZE);

  return (
    <AdminShell user={user} roles={roles}>
      <h1 style={{ margin: 0 }}>Admin audit log</h1>
      <p style={{ opacity: 0.6, marginTop: '0.25rem' }}>
        Latest {PAGE_SIZE} privileged actions. Immutable.
      </p>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1.5rem' }}>
        <thead>
          <tr>
            <Th>At</Th>
            <Th>Actor</Th>
            <Th>Role</Th>
            <Th>Action</Th>
            <Th>Target</Th>
            <Th>Reason</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={String(r.a.id)}>
              <Td>{r.a.at.toISOString().replace('T', ' ').slice(0, 19)}</Td>
              <Td>{r.actor?.email ?? r.a.actorUserId}</Td>
              <Td>{r.a.actorRole ?? '—'}</Td>
              <Td>
                <code>{r.a.action}</code>
              </Td>
              <Td style={{ fontSize: 12 }}>
                {r.a.targetType ? `${r.a.targetType}/${r.a.targetId ?? ''}` : '—'}
              </Td>
              <Td style={{ fontSize: 12, opacity: 0.7 }}>{r.a.reason ?? '—'}</Td>
            </tr>
          ))}
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
