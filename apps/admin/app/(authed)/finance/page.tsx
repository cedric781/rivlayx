import { desc } from 'drizzle-orm';
import { requireSession } from '@rivlayx/auth/next';
import { deposits, orphanDeposits, reconciliationRuns } from '@rivlayx/db';
import { deposits as coreDeposits } from '@rivlayx/core';
import { getDb } from '@/lib/db';
import { AdminShell } from '@/components/admin-shell';
import { StatusBadge } from '@/components/status-badge';

export const metadata = { title: 'Finance — RivlayX Admin' };

export default async function FinancePage() {
  const { user, roles } = await requireSession(getDb, {
    app: 'admin',
    minRole: 'admin',
    loginPath: '/login',
    mfaPath: '/mfa',
  });
  const db = getDb();
  const recentDeposits = await db
    .select()
    .from(deposits)
    .orderBy(desc(deposits.detectedAt))
    .limit(30);
  const orphans = await db
    .select()
    .from(orphanDeposits)
    .orderBy(desc(orphanDeposits.detectedAt))
    .limit(30);
  const recon = await db
    .select()
    .from(reconciliationRuns)
    .orderBy(desc(reconciliationRuns.runAt))
    .limit(20);
  const tvl = await coreDeposits.computeCurrentTvl(db);

  return (
    <AdminShell user={user} roles={roles}>
      <h1 style={{ margin: 0 }}>Finance</h1>
      <p style={{ opacity: 0.6, marginTop: '0.25rem' }}>
        Current TVL: <strong>{tvl} USDC</strong>
      </p>

      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: 18 }}>Recent deposits</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <Th>Detected</Th>
              <Th>Amount</Th>
              <Th>User</Th>
              <Th>Tx signature</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {recentDeposits.map((d) => (
              <tr key={d.id}>
                <Td>{d.detectedAt.toISOString().slice(0, 19).replace('T', ' ')}</Td>
                <Td>{d.amountUsdc}</Td>
                <Td>
                  <code style={{ fontSize: 11 }}>{d.userId.slice(0, 8)}</code>
                </Td>
                <Td style={{ fontSize: 11 }}>{d.txSignature.slice(0, 12)}…</Td>
                <Td>
                  <StatusBadge
                    label={d.status}
                    tone={
                      d.status === 'credited' ? 'green' : d.status === 'rejected' ? 'red' : 'yellow'
                    }
                  />
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: 18 }}>Orphan deposits (manual review)</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <Th>Detected</Th>
              <Th>Amount</Th>
              <Th>Source wallet</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {orphans.map((o) => (
              <tr key={o.id}>
                <Td>{o.detectedAt.toISOString().slice(0, 19).replace('T', ' ')}</Td>
                <Td>{o.amountUsdc}</Td>
                <Td style={{ fontSize: 11 }}>{o.sourceWallet.slice(0, 12)}…</Td>
                <Td>
                  <StatusBadge
                    label={o.status}
                    tone={o.status === 'pending_review' ? 'yellow' : 'gray'}
                  />
                </Td>
              </tr>
            ))}
            {orphans.length === 0 && (
              <tr>
                <Td colSpan={4} style={{ opacity: 0.6 }}>
                  No orphan deposits.
                </Td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: 18 }}>Reconciliation history</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <Th>Run at</Th>
              <Th>Status</Th>
              <Th>Ledger</Th>
              <Th>On-chain</Th>
              <Th>Drift</Th>
            </tr>
          </thead>
          <tbody>
            {recon.map((r) => (
              <tr key={String(r.id)}>
                <Td>{r.runAt.toISOString().slice(0, 19).replace('T', ' ')}</Td>
                <Td>
                  <StatusBadge
                    label={r.status}
                    tone={r.status === 'ok' ? 'green' : r.status === 'drift' ? 'yellow' : 'red'}
                  />
                </Td>
                <Td>{r.ledgerTotalUsdc ?? '—'}</Td>
                <Td>{r.onChainTotalUsdc ?? '—'}</Td>
                <Td>{r.driftUsdc ?? '—'}</Td>
              </tr>
            ))}
            {recon.length === 0 && (
              <tr>
                <Td colSpan={5} style={{ opacity: 0.6 }}>
                  No reconciliation runs yet.
                </Td>
              </tr>
            )}
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
