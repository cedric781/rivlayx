import Link from 'next/link';
import { desc, eq, ne } from 'drizzle-orm';
import { requireSession } from '@rivlayx/auth/next';
import { bets, payouts, payoutAttempts } from '@rivlayx/db';
import { getDb } from '@/lib/db';
import { AdminShell } from '@/components/admin-shell';
import { StatusBadge } from '@/components/status-badge';

export const metadata = { title: 'Payouts — RivlayX Admin' };

const PAGE_SIZE = 50;

function badgeForPayoutStatus(s: string) {
  switch (s) {
    case 'succeeded':
      return 'green';
    case 'failed':
    case 'cancelled':
      return 'red';
    case 'processing':
      return 'blue';
    case 'pending':
    default:
      return 'yellow';
  }
}

export default async function PayoutsPage() {
  const { user, roles } = await requireSession(getDb, {
    app: 'admin',
    minRole: 'moderator',
    loginPath: '/login',
    mfaPath: '/mfa',
  });
  const db = getDb();

  const pending = await db
    .select({ p: payouts, bet: { id: bets.id, shortCode: bets.shortCode } })
    .from(payouts)
    .leftJoin(bets, eq(bets.id, payouts.betId))
    .where(eq(payouts.status, 'pending'))
    .orderBy(desc(payouts.nextAttemptAt))
    .limit(PAGE_SIZE);

  const failed = await db
    .select({ p: payouts, bet: { id: bets.id, shortCode: bets.shortCode } })
    .from(payouts)
    .leftJoin(bets, eq(bets.id, payouts.betId))
    .where(eq(payouts.status, 'failed'))
    .orderBy(desc(payouts.failedAt))
    .limit(PAGE_SIZE);

  const succeeded = await db
    .select({ p: payouts, bet: { id: bets.id, shortCode: bets.shortCode } })
    .from(payouts)
    .leftJoin(bets, eq(bets.id, payouts.betId))
    .where(eq(payouts.status, 'succeeded'))
    .orderBy(desc(payouts.succeededAt))
    .limit(PAGE_SIZE);

  const recentAttempts = await db
    .select()
    .from(payoutAttempts)
    .where(ne(payoutAttempts.status, 'succeeded'))
    .orderBy(desc(payoutAttempts.attemptedAt))
    .limit(PAGE_SIZE);

  return (
    <AdminShell user={user} roles={roles}>
      <h1 style={{ margin: 0 }}>Payouts</h1>
      <p style={{ opacity: 0.6, marginTop: '0.25rem' }}>
        Payout queue monitor. Pending rows wait for the next runner pass; failed rows have exhausted
        retries or hit a permanent error.
      </p>

      <Section title={`Pending (${pending.length})`}>
        <PayoutTable
          rows={pending.map((r) => ({ p: r.p, bet: r.bet, kindHint: 'pending' }))}
          showNextAttempt
        />
      </Section>

      <Section title={`Failed (${failed.length})`}>
        <PayoutTable rows={failed.map((r) => ({ p: r.p, bet: r.bet, kindHint: 'failed' }))} />
      </Section>

      <Section title={`Recent succeeded (${succeeded.length})`}>
        <PayoutTable
          rows={succeeded.map((r) => ({ p: r.p, bet: r.bet, kindHint: 'succeeded' }))}
          showSignature
        />
      </Section>

      <Section title="Recent failed attempts">
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <Th>Attempted</Th>
              <Th>Payout</Th>
              <Th>#</Th>
              <Th>Status</Th>
              <Th>Error</Th>
            </tr>
          </thead>
          <tbody>
            {recentAttempts.map((a) => (
              <tr key={String(a.id)}>
                <Td>{a.attemptedAt.toISOString().slice(0, 19).replace('T', ' ')}</Td>
                <Td>
                  <code style={{ fontSize: 11, opacity: 0.7 }}>{a.payoutId.slice(0, 8)}</code>
                </Td>
                <Td>{a.attemptNumber}</Td>
                <Td>
                  <StatusBadge label={a.status} tone={a.status === 'succeeded' ? 'green' : 'red'} />
                </Td>
                <Td style={{ fontSize: 12, opacity: 0.7 }}>{a.errorMessage ?? '—'}</Td>
              </tr>
            ))}
            {recentAttempts.length === 0 && (
              <tr>
                <Td colSpan={5} style={{ opacity: 0.6 }}>
                  No failed attempts in the last {PAGE_SIZE} records.
                </Td>
              </tr>
            )}
          </tbody>
        </table>
      </Section>
    </AdminShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: '2rem' }}>
      <h2 style={{ fontSize: 18 }}>{title}</h2>
      {children}
    </section>
  );
}

interface PayoutRow {
  p: typeof payouts.$inferSelect;
  bet: { id: string; shortCode: string } | null;
  kindHint: string;
}

function PayoutTable({
  rows,
  showNextAttempt,
  showSignature,
}: {
  rows: PayoutRow[];
  showNextAttempt?: boolean;
  showSignature?: boolean;
}) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <Th>Bet</Th>
          <Th>Amount</Th>
          <Th>Status</Th>
          <Th>Attempts</Th>
          {showNextAttempt && <Th>Next attempt</Th>}
          {showSignature && <Th>Signature</Th>}
          <Th>Destination</Th>
          <Th>Error</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.p.id}>
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
            <Td>{row.p.amountUsdc} USDC</Td>
            <Td>
              <StatusBadge
                label={row.p.status}
                tone={badgeForPayoutStatus(row.p.status) as 'green' | 'red' | 'yellow' | 'blue'}
              />
            </Td>
            <Td>
              {row.p.attempts} / {row.p.maxAttempts}
            </Td>
            {showNextAttempt && (
              <Td style={{ fontSize: 12 }}>
                {row.p.nextAttemptAt.toISOString().slice(0, 19).replace('T', ' ')}
              </Td>
            )}
            {showSignature && (
              <Td style={{ fontSize: 11 }}>
                <code>{row.p.txSignature?.slice(0, 16) ?? '—'}…</code>
              </Td>
            )}
            <Td style={{ fontSize: 11 }}>
              <code>{row.p.destinationWallet.slice(0, 12)}…</code>
            </Td>
            <Td style={{ fontSize: 12, opacity: 0.7 }}>{row.p.lastError ?? '—'}</Td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <Td colSpan={showNextAttempt || showSignature ? 8 : 7} style={{ opacity: 0.6 }}>
              No rows.
            </Td>
          </tr>
        )}
      </tbody>
    </table>
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
