import Link from 'next/link';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { requireSession } from '@rivlayx/auth/next';
import { bets, type BetStatus } from '@rivlayx/db';
import { getDb } from '@/lib/db';
import { AdminShell } from '@/components/admin-shell';
import { StatusBadge, toneForBetStatus } from '@/components/status-badge';

export const metadata = { title: 'Resolve queue — RivlayX Admin' };

const PAGE_SIZE = 100;
/** Bets awaiting an admin decision: live or event-over, arbiter-resolved, no winner yet. */
const NEEDS_RESOLUTION: BetStatus[] = ['ACTIVE', 'AWAITING_RESULT'];

export default async function ResolveQueuePage() {
  const { user, roles } = await requireSession(getDb, {
    app: 'admin',
    minRole: 'moderator',
    loginPath: '/login',
    mfaPath: '/mfa',
  });

  const db = getDb();
  const rows = await db
    .select({
      id: bets.id,
      shortCode: bets.shortCode,
      title: bets.title,
      status: bets.status,
      stakePerSideUsdc: bets.stakePerSideUsdc,
      proposedWinnerUserId: bets.proposedWinnerUserId,
      activatedAt: bets.activatedAt,
    })
    .from(bets)
    .where(
      and(
        inArray(bets.status, NEEDS_RESOLUTION),
        eq(bets.resolveType, 'arbiter'),
        isNull(bets.resolvedWinnerUserId),
      ),
    )
    .orderBy(desc(bets.activatedAt))
    .limit(PAGE_SIZE);

  return (
    <AdminShell user={user} roles={roles}>
      <h1 style={{ margin: 0 }}>Resolve queue</h1>
      <p style={{ marginTop: '0.5rem', opacity: 0.6, fontSize: 13 }}>
        Arbiter-resolved bets awaiting an admin decision. Open one to view details, evidence, and
        rule a winner. After the dispute window the existing settlement flow pays out.
      </p>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1.5rem' }}>
        <thead>
          <tr>
            <Th>Bet</Th>
            <Th>Title</Th>
            <Th>Stake</Th>
            <Th>Status</Th>
            <Th>Proposed?</Th>
            <Th>Actions</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <Td colSpan={6} style={{ opacity: 0.6 }}>
                Nothing awaiting resolution.
              </Td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.id}>
                <Td>
                  <Link href={`/bets/${r.id}`} style={{ color: '#5b8def', fontFamily: 'monospace' }}>
                    {r.shortCode}
                  </Link>
                </Td>
                <Td>{r.title}</Td>
                <Td>{r.stakePerSideUsdc}</Td>
                <Td>
                  <StatusBadge label={r.status} tone={toneForBetStatus(r.status)} />
                </Td>
                <Td>{r.proposedWinnerUserId ? 'yes — window open' : 'no'}</Td>
                <Td>
                  <Link href={`/bets/${r.id}`} style={{ color: '#5b8def', fontSize: 13 }}>
                    Resolve →
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
      style={{ padding: '0.6rem 0.75rem', borderBottom: '1px solid #2c3036', fontSize: 13, ...style }}
    >
      {children}
    </td>
  );
}
