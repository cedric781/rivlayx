import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { requireSession } from '@rivlayx/auth/next';
import { betEvidence, bets, users } from '@rivlayx/db';
import { getDb } from '@/lib/db';
import { AdminShell } from '@/components/admin-shell';

export const metadata = { title: 'Evidence — RivlayX Admin' };

const PAGE_SIZE = 50;

export default async function EvidencePage() {
  const { user, roles } = await requireSession(getDb, {
    app: 'admin',
    minRole: 'moderator',
    loginPath: '/login',
    mfaPath: '/mfa',
  });
  const db = getDb();
  const rows = await db
    .select({
      e: betEvidence,
      bet: { id: bets.id, shortCode: bets.shortCode, status: bets.status },
      uploader: { email: users.email },
    })
    .from(betEvidence)
    .leftJoin(bets, eq(bets.id, betEvidence.betId))
    .leftJoin(users, eq(users.id, betEvidence.uploaderUserId))
    .orderBy(desc(betEvidence.uploadedAt))
    .limit(PAGE_SIZE);

  return (
    <AdminShell user={user} roles={roles}>
      <h1 style={{ margin: 0 }}>Evidence</h1>
      <p style={{ opacity: 0.6, marginTop: '0.25rem' }}>
        Latest {PAGE_SIZE} uploads. Storage keys point at the object store — copy + paste into the
        bucket viewer to inspect.
      </p>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1.5rem' }}>
        <thead>
          <tr>
            <Th>Uploaded</Th>
            <Th>Bet</Th>
            <Th>Uploader</Th>
            <Th>SHA-256</Th>
            <Th>Type</Th>
            <Th>Storage key</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.e.id}>
              <Td>{r.e.uploadedAt.toISOString().slice(0, 19).replace('T', ' ')}</Td>
              <Td>
                {r.bet ? (
                  <Link
                    href={`/bets/${r.bet.id}`}
                    style={{ color: '#5b8def', fontFamily: 'monospace' }}
                  >
                    {r.bet.shortCode}
                  </Link>
                ) : (
                  '—'
                )}
              </Td>
              <Td>{r.uploader?.email ?? '—'}</Td>
              <Td style={{ fontSize: 11, wordBreak: 'break-all' }}>{r.e.sha256.slice(0, 16)}…</Td>
              <Td>{r.e.contentType ?? '—'}</Td>
              <Td style={{ fontSize: 11, wordBreak: 'break-all' }}>{r.e.storageKey}</Td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <Td colSpan={6} style={{ opacity: 0.6 }}>
                No evidence yet.
              </Td>
            </tr>
          )}
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
