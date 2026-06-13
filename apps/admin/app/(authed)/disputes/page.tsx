import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { requireSession } from '@rivlayx/auth/next';
import { bets, disputes, users } from '@rivlayx/db';
import { getDb } from '@/lib/db';
import { AdminShell } from '@/components/admin-shell';
import { StatusBadge, toneForDisputeStatus } from '@/components/status-badge';

export const metadata = { title: 'Disputes — RivlayX Admin' };

const PAGE_SIZE = 100;

export default async function DisputesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { user, roles } = await requireSession(getDb, {
    app: 'admin',
    minRole: 'moderator',
    loginPath: '/login',
    mfaPath: '/mfa',
  });
  const params = await searchParams;
  const statusFilter = params.status;

  const db = getDb();
  const rows = await db
    .select({
      dispute: disputes,
      bet: { id: bets.id, shortCode: bets.shortCode, status: bets.status },
      opener: { id: users.id, email: users.email },
    })
    .from(disputes)
    .leftJoin(bets, eq(bets.id, disputes.betId))
    .leftJoin(users, eq(users.id, disputes.openerUserId))
    .orderBy(desc(disputes.openedAt))
    .limit(PAGE_SIZE);

  const filtered = statusFilter ? rows.filter((r) => r.dispute.status === statusFilter) : rows;

  return (
    <AdminShell user={user} roles={roles}>
      <h1 style={{ margin: 0 }}>Disputes</h1>
      <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
        <FilterLink current={statusFilter} value={undefined} label="All" />
        <FilterLink current={statusFilter} value="open" label="Open" />
        <FilterLink current={statusFilter} value="upheld" label="Upheld" />
        <FilterLink current={statusFilter} value="rejected" label="Rejected" />
        <FilterLink current={statusFilter} value="withdrawn" label="Withdrawn" />
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1.5rem' }}>
        <thead>
          <tr>
            <Th>Opened</Th>
            <Th>Bet</Th>
            <Th>Opener</Th>
            <Th>Deposit</Th>
            <Th>Status</Th>
            <Th>Actions</Th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr>
              <Td colSpan={6} style={{ opacity: 0.6 }}>
                No disputes match this filter.
              </Td>
            </tr>
          ) : (
            filtered.map((r) => (
              <tr key={r.dispute.id}>
                <Td>{new Date(r.dispute.openedAt).toISOString().slice(0, 19).replace('T', ' ')}</Td>
                <Td>
                  <Link
                    href={`/bets/${r.bet?.id}`}
                    style={{ color: '#5b8def', fontFamily: 'monospace' }}
                  >
                    {r.bet?.shortCode ?? '—'}
                  </Link>
                </Td>
                <Td>{r.opener?.email ?? '—'}</Td>
                <Td>{r.dispute.depositUsdc}</Td>
                <Td>
                  <StatusBadge
                    label={r.dispute.status}
                    tone={toneForDisputeStatus(r.dispute.status)}
                  />
                </Td>
                <Td>
                  <Link
                    href={`/disputes/${r.dispute.id}`}
                    style={{ color: '#5b8def', fontSize: 13 }}
                  >
                    Open →
                  </Link>
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </AdminShell>
  );
}

function FilterLink({
  current,
  value,
  label,
}: {
  current: string | undefined;
  value: string | undefined;
  label: string;
}) {
  const active = current === value;
  const href = value ? `/disputes?status=${value}` : '/disputes';
  return (
    <Link
      href={href}
      style={{
        padding: '4px 10px',
        background: active ? '#5b8def' : 'transparent',
        color: active ? 'white' : '#9fa6ad',
        border: '1px solid #2c3036',
        borderRadius: 4,
        textDecoration: 'none',
        fontSize: 13,
      }}
    >
      {label}
    </Link>
  );
}

function Th({ children }: { children: React.ReactNode }) {
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

function Td({
  children,
  colSpan,
  style,
}: {
  children: React.ReactNode;
  colSpan?: number;
  style?: React.CSSProperties;
}) {
  return (
    <td
      colSpan={colSpan}
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
