import { requireSession } from '@rivlayx/auth/next';
import { risk } from '@rivlayx/core';
import { getDb } from '@/lib/db';
import { AdminShell } from '@/components/admin-shell';

export const metadata = { title: 'Risk — RivlayX Admin' };

/**
 * Risk engine dashboard (Sprint 17) — SHADOW MODE, READ ONLY. Surfaces advisory
 * scores and alerts for analyst review. No control here triggers any action;
 * triage actions (triaged/dismissed/actioned) only change alert status.
 */
export default async function RiskDashboardPage() {
  const { user, roles } = await requireSession(getDb, {
    app: 'admin',
    minRole: 'admin',
    loginPath: '/login',
    mfaPath: '/mfa',
  });
  const db = getDb();
  const [analytics, topUsers, openAlerts, clusters] = await Promise.all([
    risk.getRiskAnalytics(db),
    risk.listTopRiskUsers(db, { limit: 25 }),
    risk.listOpenAlerts(db, { limit: 100 }),
    risk.listRingClusters(db, { limit: 25 }),
  ]);

  const byType = (t: string) => openAlerts.filter((a) => a.type === t);

  return (
    <AdminShell user={user} roles={roles}>
      <h1 style={{ margin: 0 }}>Risk</h1>
      <p style={{ opacity: 0.6, marginTop: '0.25rem' }}>
        Shadow mode — advisory detection only. Nothing here blocks, freezes or affects money flow.
      </p>

      <section style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: '1.5rem' }}>
        <StatCard label="Open alerts" value={openAlerts.length} />
        <StatCard label="Ring clusters" value={analytics.ringClusters} />
        <StatCard label="Queue depth" value={analytics.queueDepth} />
        {analytics.bandDistribution
          .filter((b) => b.band === 'high' || b.band === 'critical')
          .map((b) => (
            <StatCard key={b.band} label={`${b.band} users`} value={b.count} />
          ))}
      </section>

      <AlertSection title="Open alerts" alerts={openAlerts} />

      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: 18 }}>Top risk users</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <Th>User</Th>
              <Th>Score</Th>
              <Th>Band</Th>
              <Th>Ring</Th>
              <Th>Arb.conc</Th>
              <Th>Conc</Th>
              <Th>Wash</Th>
              <Th>Abuse</Th>
              <Th>Velocity</Th>
              <Th>Funding</Th>
            </tr>
          </thead>
          <tbody>
            {topUsers.length === 0 ? (
              <tr>
                <Td colSpan={10} style={{ opacity: 0.6 }}>
                  No risk scores computed yet.
                </Td>
              </tr>
            ) : (
              topUsers.map((u) => (
                <tr key={u.userId}>
                  <Td>@{u.username}</Td>
                  <Td>{u.riskScore}</Td>
                  <Td style={{ textTransform: 'capitalize' }}>{u.riskBand}</Td>
                  <Td>{u.ringScore}</Td>
                  <Td>{u.arbiterConcentrationScore}</Td>
                  <Td>{u.concentrationScore}</Td>
                  <Td>{u.washScore}</Td>
                  <Td>{u.abuseScore}</Td>
                  <Td>{u.velocityScore}</Td>
                  <Td>{u.fundingOverlapScore}</Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: 18 }}>Ring clusters</h2>
        <table style={{ width: '100%', maxWidth: 560, borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <Th>Cluster</Th>
              <Th>Members</Th>
              <Th>Max ring score</Th>
            </tr>
          </thead>
          <tbody>
            {clusters.length === 0 ? (
              <tr>
                <Td colSpan={3} style={{ opacity: 0.6 }}>
                  No clusters detected.
                </Td>
              </tr>
            ) : (
              clusters.map((c) => (
                <tr key={c.clusterId}>
                  <Td style={{ fontFamily: 'monospace', fontSize: 12 }}>{c.clusterId.slice(0, 8)}</Td>
                  <Td>{c.memberCount}</Td>
                  <Td>{c.maxRingScore}</Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <AlertSection title="Sybil clusters" alerts={byType('sybil')} />
      <AlertSection title="Wash-trade alerts" alerts={byType('wash_trade')} />
      <AlertSection title="Dispute-abuse alerts" alerts={byType('dispute_abuse')} />
    </AdminShell>
  );
}

function AlertSection({
  title,
  alerts,
}: {
  title: string;
  alerts: Awaited<ReturnType<typeof risk.listOpenAlerts>>;
}) {
  return (
    <section style={{ marginTop: '2rem' }}>
      <h2 style={{ fontSize: 18 }}>{title}</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <Th>Type</Th>
            <Th>Subject</Th>
            <Th>Severity</Th>
            <Th>Score</Th>
            <Th>Created</Th>
          </tr>
        </thead>
        <tbody>
          {alerts.length === 0 ? (
            <tr>
              <Td colSpan={5} style={{ opacity: 0.6 }}>
                None.
              </Td>
            </tr>
          ) : (
            alerts.map((a) => (
              <tr key={a.id}>
                <Td>{a.type}</Td>
                <Td style={{ fontFamily: 'monospace', fontSize: 12 }}>
                  {a.subjectType}:{a.subjectId.slice(0, 8)}
                </Td>
                <Td style={{ textTransform: 'capitalize' }}>{a.severity}</Td>
                <Td>{a.score}</Td>
                <Td>{new Date(a.createdAt).toISOString().slice(0, 16).replace('T', ' ')}</Td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
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
