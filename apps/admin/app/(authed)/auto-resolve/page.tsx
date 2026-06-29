import Link from 'next/link';
import { and, desc, eq, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { requireSession } from '@rivlayx/auth/next';
import { formatUsdc } from '@rivlayx/shared';
import { autoResolveAttempts, bets } from '@rivlayx/db';
import { getDb } from '@/lib/db';
import { AdminShell } from '@/components/admin-shell';
import { StatusBadge, toneForBetStatus } from '@/components/status-badge';

export const metadata = { title: 'Auto resolve — RivlayX Admin' };

const PAGE_SIZE = 50;

export default async function AutoResolvePage() {
  const { user, roles } = await requireSession(getDb, {
    app: 'admin',
    minRole: 'moderator',
    loginPath: '/login',
    mfaPath: '/mfa',
  });
  const db = getDb();

  // Pending auto-resolves: ACTIVE/AWAITING_RESULT bets with resolve_type='auto'
  // whose event has passed and that have no proposal yet.
  const pending = await db
    .select()
    .from(bets)
    .where(
      and(
        or(eq(bets.status, 'ACTIVE'), eq(bets.status, 'AWAITING_RESULT')),
        eq(bets.resolveType, 'auto'),
        isNull(bets.proposedWinnerUserId),
        sql`${bets.eventAt} IS NOT NULL`,
        lte(bets.eventAt, new Date()),
      ),
    )
    .orderBy(desc(bets.eventAt))
    .limit(PAGE_SIZE);

  // Recent attempts (any non-final entries surface first).
  const recentAttempts = await db
    .select({ a: autoResolveAttempts, bet: { shortCode: bets.shortCode, id: bets.id } })
    .from(autoResolveAttempts)
    .leftJoin(bets, eq(bets.id, autoResolveAttempts.betId))
    .orderBy(desc(autoResolveAttempts.attemptedAt))
    .limit(PAGE_SIZE);

  // Failed attempts only
  const failedAttempts = await db
    .select({ a: autoResolveAttempts, bet: { shortCode: bets.shortCode, id: bets.id } })
    .from(autoResolveAttempts)
    .leftJoin(bets, eq(bets.id, autoResolveAttempts.betId))
    .where(ne(autoResolveAttempts.status, 'final'))
    .orderBy(desc(autoResolveAttempts.attemptedAt))
    .limit(PAGE_SIZE);

  return (
    <AdminShell user={user} roles={roles}>
      <h1 style={{ margin: 0 }}>Auto resolve</h1>
      <p style={{ opacity: 0.6, marginTop: '0.25rem' }}>
        Auto-resolve runner monitor. Pending bets wait for the next runner pass; failed attempts
        keep the audit history for follow-up.
      </p>

      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: 18 }}>Pending auto resolves ({pending.length})</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <Th>Event at</Th>
              <Th>Bet</Th>
              <Th>Status</Th>
              <Th>Stake</Th>
              <Th>Provider hint</Th>
            </tr>
          </thead>
          <tbody>
            {pending.map((b) => (
              <tr key={b.id}>
                <Td>{b.eventAt?.toISOString().slice(0, 19).replace('T', ' ') ?? '—'}</Td>
                <Td>
                  <Link
                    href={`/bets/${b.id}`}
                    style={{ color: '#5b8def', fontFamily: 'monospace' }}
                  >
                    {b.shortCode}
                  </Link>
                </Td>
                <Td>
                  <StatusBadge label={b.status} tone={toneForBetStatus(b.status)} />
                </Td>
                <Td>{formatUsdc(b.stakePerSideUsdc)}</Td>
                <Td style={{ fontSize: 12 }}>
                  {(b.resolveSource as { provider?: string } | null)?.provider ?? '—'}
                </Td>
              </tr>
            ))}
            {pending.length === 0 && (
              <tr>
                <Td colSpan={5} style={{ opacity: 0.6 }}>
                  No bets waiting for auto resolve.
                </Td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: 18 }}>Failed / pending attempts</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <Th>Attempted</Th>
              <Th>Bet</Th>
              <Th>Provider</Th>
              <Th>Status</Th>
              <Th>Message</Th>
            </tr>
          </thead>
          <tbody>
            {failedAttempts.map((row) => (
              <tr key={String(row.a.id)}>
                <Td>{row.a.attemptedAt.toISOString().slice(0, 19).replace('T', ' ')}</Td>
                <Td>
                  {row.bet ? (
                    <Link
                      href={`/bets/${row.bet.id}`}
                      style={{ color: '#5b8def', fontFamily: 'monospace' }}
                    >
                      {row.bet.shortCode}
                    </Link>
                  ) : (
                    '—'
                  )}
                </Td>
                <Td>
                  <code>{row.a.provider}</code>
                </Td>
                <Td>
                  <StatusBadge
                    label={row.a.status}
                    tone={
                      row.a.status === 'error' || row.a.status === 'invalid'
                        ? 'red'
                        : row.a.status === 'pending'
                          ? 'yellow'
                          : 'gray'
                    }
                  />
                </Td>
                <Td style={{ fontSize: 12, opacity: 0.7 }}>{row.a.errorMessage ?? '—'}</Td>
              </tr>
            ))}
            {failedAttempts.length === 0 && (
              <tr>
                <Td colSpan={5} style={{ opacity: 0.6 }}>
                  No failed or pending attempts in the last {PAGE_SIZE} records.
                </Td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: 18 }}>All recent attempts</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <Th>Attempted</Th>
              <Th>Bet</Th>
              <Th>Provider</Th>
              <Th>Status</Th>
              <Th>Message</Th>
            </tr>
          </thead>
          <tbody>
            {recentAttempts.map((row) => (
              <tr key={String(row.a.id)}>
                <Td>{row.a.attemptedAt.toISOString().slice(0, 19).replace('T', ' ')}</Td>
                <Td>
                  {row.bet ? (
                    <Link
                      href={`/bets/${row.bet.id}`}
                      style={{ color: '#5b8def', fontFamily: 'monospace' }}
                    >
                      {row.bet.shortCode}
                    </Link>
                  ) : (
                    '—'
                  )}
                </Td>
                <Td>
                  <code>{row.a.provider}</code>
                </Td>
                <Td>
                  <StatusBadge
                    label={row.a.status}
                    tone={
                      row.a.status === 'final'
                        ? 'green'
                        : row.a.status === 'error' || row.a.status === 'invalid'
                          ? 'red'
                          : 'yellow'
                    }
                  />
                </Td>
                <Td style={{ fontSize: 12, opacity: 0.7 }}>{row.a.errorMessage ?? '—'}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
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
