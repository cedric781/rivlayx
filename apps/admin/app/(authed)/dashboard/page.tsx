import { count, eq, sql } from 'drizzle-orm';
import { requireSession } from '@rivlayx/auth/next';
import {
  bets,
  deposits,
  disputes,
  freezeState,
  orphanDeposits,
  reconciliationRuns,
  users,
} from '@rivlayx/db';
import { deposits as coreDeposits, ops } from '@rivlayx/core';
import { getDb } from '@/lib/db';
import { AdminShell } from '@/components/admin-shell';
import { StatusBadge } from '@/components/status-badge';

export const metadata = { title: 'Admin dashboard — RivlayX' };

export default async function AdminDashboardPage() {
  const { user, roles } = await requireSession(getDb, {
    app: 'admin',
    minRole: 'moderator',
    loginPath: '/login',
    mfaPath: '/mfa',
  });

  const db = getDb();
  const [openDisputes] = await db
    .select({ n: count() })
    .from(disputes)
    .where(eq(disputes.status, 'open'));
  const [pendingReview] = await db
    .select({ n: count() })
    .from(bets)
    .where(eq(bets.status, 'AWAITING_RESULT'));
  const [pendingDeposits] = await db
    .select({ n: count() })
    .from(deposits)
    .where(eq(deposits.status, 'pending'));
  const [confirmedDeposits] = await db
    .select({ n: count() })
    .from(deposits)
    .where(eq(deposits.status, 'confirmed'));
  const [pendingOrphans] = await db
    .select({ n: count() })
    .from(orphanDeposits)
    .where(eq(orphanDeposits.status, 'pending_review'));
  const [bannedUsers] = await db
    .select({ n: count() })
    .from(users)
    .where(eq(users.status, 'banned'));
  const [suspendedUsers] = await db
    .select({ n: count() })
    .from(users)
    .where(eq(users.status, 'suspended'));
  const freezeRows = await db
    .select({ component: freezeState.component, frozen: freezeState.frozen })
    .from(freezeState);
  const [lastRecon] = await db
    .select({
      runAt: reconciliationRuns.runAt,
      status: reconciliationRuns.status,
      drift: reconciliationRuns.driftUsdc,
    })
    .from(reconciliationRuns)
    .orderBy(sql`${reconciliationRuns.runAt} DESC`)
    .limit(1);
  const currentTvl = await coreDeposits.computeCurrentTvl(db);
  const [openBets] = await db.select({ n: count() }).from(bets).where(eq(bets.status, 'OPEN'));
  const [activeBets] = await db.select({ n: count() }).from(bets).where(eq(bets.status, 'ACTIVE'));
  const opsOverview = await ops.getOpsOverview(db);
  const opsAlerts = await ops.listActiveOpsAlerts(db, { limit: 50 });

  return (
    <AdminShell user={user} roles={roles}>
      <h1 style={{ margin: 0 }}>Operations dashboard</h1>
      <p style={{ opacity: 0.6, marginTop: '0.25rem' }}>
        High-level monitors. Drill into the sidebar for details.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '1rem',
          marginTop: '1.5rem',
        }}
      >
        <Card label="Open disputes" value={openDisputes?.n ?? 0} link="/disputes" />
        <Card
          label="Pending review"
          value={pendingReview?.n ?? 0}
          link="/bets?status=AWAITING_RESULT"
        />
        <Card label="Pending deposits" value={pendingDeposits?.n ?? 0} link="/finance" />
        <Card label="Confirmed deposits" value={confirmedDeposits?.n ?? 0} link="/finance" />
        <Card label="Orphan deposits" value={pendingOrphans?.n ?? 0} link="/finance" />
        <Card label="Open bets" value={openBets?.n ?? 0} link="/bets?status=OPEN" />
        <Card label="Active bets" value={activeBets?.n ?? 0} link="/bets?status=ACTIVE" />
        <Card label="Banned users" value={bannedUsers?.n ?? 0} link="/users?status=banned" />
        <Card
          label="Suspended users"
          value={suspendedUsers?.n ?? 0}
          link="/users?status=suspended"
        />
      </div>

      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: 18 }}>TVL monitor</h2>
        <p>
          Current TVL: <strong>{currentTvl} USDC</strong>
        </p>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: 18 }}>Reconciliation</h2>
        {lastRecon ? (
          <p>
            Last run: {new Date(lastRecon.runAt).toISOString()} —{' '}
            <StatusBadge
              label={lastRecon.status}
              tone={
                lastRecon.status === 'ok'
                  ? 'green'
                  : lastRecon.status === 'drift'
                    ? 'yellow'
                    : 'red'
              }
            />
            {lastRecon.drift && <> · drift {lastRecon.drift} USDC</>}
          </p>
        ) : (
          <p style={{ opacity: 0.6 }}>No reconciliation runs yet.</p>
        )}
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: 18 }}>Cron health</h2>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {opsOverview.cronHealth.map((c) => (
            <StatusBadge
              key={c.job}
              label={`${c.job}: ${
                c.lastStatus === 'never'
                  ? 'never run'
                  : c.failing
                    ? 'failing'
                    : c.stale
                      ? `stale (${c.lastRunAgeMinutes}m)`
                      : `ok (${c.lastRunAgeMinutes}m)`
              }`}
              tone={c.failing || c.lastStatus === 'never' ? 'red' : c.stale ? 'yellow' : 'green'}
            />
          ))}
        </div>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: 18 }}>
          Ops alerts{' '}
          {opsOverview.criticalAlerts > 0 && (
            <StatusBadge label={`${opsOverview.criticalAlerts} critical`} tone="red" />
          )}
        </h2>
        {opsAlerts.length === 0 ? (
          <p style={{ opacity: 0.6 }}>No active ops alerts.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Severity</th>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Title</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Runbook</th>
              </tr>
            </thead>
            <tbody>
              {opsAlerts.map((a) => (
                <tr key={a.id}>
                  <td style={tdStyle}>
                    <StatusBadge
                      label={a.severity}
                      tone={a.severity === 'critical' ? 'red' : a.severity === 'warning' ? 'yellow' : 'green'}
                    />
                  </td>
                  <td style={tdStyle}>{a.type}</td>
                  <td style={tdStyle}>{a.title}</td>
                  <td style={tdStyle}>{a.status}</td>
                  <td style={tdStyle}>
                    {a.runbookUrl ? (
                      <a href={a.runbookUrl} style={{ color: '#5b8def' }}>
                        runbook →
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: 18 }}>Freeze status</h2>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {freezeRows.map((f) => (
            <StatusBadge
              key={f.component}
              label={`${f.component}: ${f.frozen ? 'FROZEN' : 'OK'}`}
              tone={f.frozen ? 'red' : 'green'}
            />
          ))}
        </div>
      </section>
    </AdminShell>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.5rem 0.6rem',
  borderBottom: '1px solid #2c3036',
  fontSize: 11,
  opacity: 0.6,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
};
const tdStyle: React.CSSProperties = {
  padding: '0.5rem 0.6rem',
  borderBottom: '1px solid #2c3036',
  fontSize: 13,
};

function Card({ label, value, link }: { label: string; value: number | string; link?: string }) {
  return (
    <div
      style={{
        background: '#13161a',
        border: '1px solid #2c3036',
        borderRadius: 8,
        padding: '1rem',
      }}
    >
      <div
        style={{
          fontSize: 11,
          textTransform: 'uppercase',
          opacity: 0.6,
          letterSpacing: 0.4,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: '0.25rem' }}>{value}</div>
      {link && (
        <a
          href={link}
          style={{ color: '#5b8def', fontSize: 12, marginTop: '0.5rem', display: 'inline-block' }}
        >
          View →
        </a>
      )}
    </div>
  );
}
