import { requireSession } from '@rivlayx/auth/next';
import { reputation } from '@rivlayx/core';
import { getDb } from '@/lib/db';
import { AdminShell } from '@/components/admin-shell';

export const metadata = { title: 'Reputation — RivlayX Admin' };

function pct(rate: string): string {
  return `${(Number(rate) * 100).toFixed(1)}%`;
}

export default async function ReputationDashboardPage() {
  const { user, roles } = await requireSession(getDb, {
    app: 'admin',
    minRole: 'admin',
    loginPath: '/login',
    mfaPath: '/mfa',
  });
  const a = await reputation.getReputationAnalytics(getDb());

  return (
    <AdminShell user={user} roles={roles}>
      <h1 style={{ margin: 0 }}>Reputation</h1>
      <p style={{ opacity: 0.6, marginTop: '0.25rem' }}>Trust health across users and arbiters.</p>

      <section style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: '1.5rem' }}>
        <StatCard label="Provisional users" value={a.provisionalUsers} />
        <StatCard label="Queue depth" value={a.queueDepth} />
        <StatCard label="Win-rate anomalies" value={a.anomalyCount} />
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: 18 }}>Tier distribution</h2>
        <table style={{ width: '100%', maxWidth: 420, borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <Th>Tier</Th>
              <Th>Users</Th>
            </tr>
          </thead>
          <tbody>
            {a.tierDistribution.length === 0 ? (
              <tr>
                <Td colSpan={2} style={{ opacity: 0.6 }}>
                  No reputation snapshots yet.
                </Td>
              </tr>
            ) : (
              a.tierDistribution.map((t) => (
                <tr key={t.tier}>
                  <Td style={{ textTransform: 'capitalize' }}>{t.tier}</Td>
                  <Td>{t.count}</Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: 18 }}>Top arbiters</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <Th>Arbiter</Th>
              <Th>Tier</Th>
              <Th>Rulings</Th>
              <Th>Acceptance</Th>
              <Th>Overturned</Th>
            </tr>
          </thead>
          <tbody>
            {a.topArbiters.length === 0 ? (
              <tr>
                <Td colSpan={5} style={{ opacity: 0.6 }}>
                  No arbiters have ruled yet.
                </Td>
              </tr>
            ) : (
              a.topArbiters.map((arb) => (
                <tr key={arb.userId}>
                  <Td>@{arb.username}</Td>
                  <Td style={{ textTransform: 'capitalize' }}>
                    {arb.arbiterProvisional ? 'new' : arb.arbiterTier}
                  </Td>
                  <Td>{arb.arbiterRulings}</Td>
                  <Td>{pct(arb.acceptanceRate)}</Td>
                  <Td>{pct(arb.overturnedRate)}</Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: 18 }}>Overturned arbitrations</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <Th>Arbiter</Th>
              <Th>Tier</Th>
              <Th>Rulings</Th>
              <Th>Overturned rate</Th>
            </tr>
          </thead>
          <tbody>
            {a.overturnedArbiters.length === 0 ? (
              <tr>
                <Td colSpan={4} style={{ opacity: 0.6 }}>
                  No overturned arbitrations.
                </Td>
              </tr>
            ) : (
              a.overturnedArbiters.map((arb) => (
                <tr key={arb.username}>
                  <Td>@{arb.username}</Td>
                  <Td style={{ textTransform: 'capitalize' }}>{arb.arbiterTier}</Td>
                  <Td>{arb.arbiterRulings}</Td>
                  <Td>{pct(arb.overturnedRate)}</Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </AdminShell>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        border: '1px solid #2c3036',
        borderRadius: 10,
        padding: '0.9rem 1.1rem',
        minWidth: 150,
      }}
    >
      <div style={{ fontSize: 11, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{value}</div>
    </div>
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
      style={{ padding: '0.6rem 0.75rem', borderBottom: '1px solid #2c3036', fontSize: 13, ...style }}
    >
      {children}
    </td>
  );
}
