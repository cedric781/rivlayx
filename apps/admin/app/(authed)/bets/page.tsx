import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { requireSession } from '@rivlayx/auth/next';
import { formatUsdc } from '@rivlayx/shared';
import { bets, type BetStatus } from '@rivlayx/db';
import { getDb } from '@/lib/db';
import { AdminShell } from '@/components/admin-shell';
import { StatusBadge, toneForBetStatus } from '@/components/status-badge';

export const metadata = { title: 'Bets — RivlayX Admin' };

const PAGE_SIZE = 100;

export default async function BetsListPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: BetStatus }>;
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
  const rows = statusFilter
    ? await db
        .select()
        .from(bets)
        .where(eq(bets.status, statusFilter))
        .orderBy(desc(bets.createdAt))
        .limit(PAGE_SIZE)
    : await db.select().from(bets).orderBy(desc(bets.createdAt)).limit(PAGE_SIZE);

  return (
    <AdminShell user={user} roles={roles}>
      <h1 style={{ margin: 0 }}>Bets</h1>
      <p style={{ opacity: 0.6, marginTop: '0.25rem' }}>
        Latest {PAGE_SIZE} bets. Filter by status via the dashboard cards.
      </p>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1.5rem' }}>
        <thead>
          <tr>
            <Th>Created</Th>
            <Th>Short code</Th>
            <Th>Status</Th>
            <Th>Type</Th>
            <Th>Stake</Th>
            <Th>Resolve</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.id}>
              <Td>{b.createdAt.toISOString().slice(0, 19).replace('T', ' ')}</Td>
              <Td>
                <code>{b.shortCode}</code>
              </Td>
              <Td>
                <StatusBadge label={b.status} tone={toneForBetStatus(b.status)} />
              </Td>
              <Td>{b.betType}</Td>
              <Td>{formatUsdc(b.stakePerSideUsdc)}</Td>
              <Td>{b.resolveType}</Td>
              <Td>
                <Link href={`/bets/${b.id}`} style={{ color: '#5b8def', fontSize: 13 }}>
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
