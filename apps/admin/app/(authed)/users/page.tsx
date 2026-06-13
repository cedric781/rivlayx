import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { requireSession } from '@rivlayx/auth/next';
import { users, type UserStatus } from '@rivlayx/db';
import { getDb } from '@/lib/db';
import { AdminShell } from '@/components/admin-shell';
import { StatusBadge, toneForUserStatus } from '@/components/status-badge';

export const metadata = { title: 'Users — RivlayX Admin' };

const PAGE_SIZE = 100;

export default async function UsersListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: UserStatus }>;
}) {
  const { user, roles } = await requireSession(getDb, {
    app: 'admin',
    minRole: 'admin',
    loginPath: '/login',
    mfaPath: '/mfa',
  });
  const params = await searchParams;
  const statusFilter = params.status;

  const db = getDb();
  const rows = statusFilter
    ? await db
        .select()
        .from(users)
        .where(eq(users.status, statusFilter))
        .orderBy(desc(users.createdAt))
        .limit(PAGE_SIZE)
    : await db.select().from(users).orderBy(desc(users.createdAt)).limit(PAGE_SIZE);

  return (
    <AdminShell user={user} roles={roles}>
      <h1 style={{ margin: 0 }}>Users</h1>
      <p style={{ opacity: 0.6, marginTop: '0.25rem' }}>Latest {PAGE_SIZE} users.</p>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1.5rem' }}>
        <thead>
          <tr>
            <Th>Created</Th>
            <Th>Email</Th>
            <Th>Status</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => (
            <tr key={u.id}>
              <Td>{u.createdAt.toISOString().slice(0, 19).replace('T', ' ')}</Td>
              <Td>
                <code>{u.email}</code>
              </Td>
              <Td>
                <StatusBadge label={u.status} tone={toneForUserStatus(u.status)} />
              </Td>
              <Td>
                <Link href={`/users/${u.id}`} style={{ color: '#5b8def', fontSize: 13 }}>
                  Open →
                </Link>
              </Td>
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

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td
      style={{
        padding: '0.6rem 0.75rem',
        borderBottom: '1px solid #2c3036',
        fontSize: 13,
      }}
    >
      {children}
    </td>
  );
}
