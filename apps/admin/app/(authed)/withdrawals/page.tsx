import { desc, eq } from 'drizzle-orm';
import { requireSession } from '@rivlayx/auth/next';
import { can } from '@rivlayx/auth';
import { users, withdrawalRequests } from '@rivlayx/db';
import { getDb } from '@/lib/db';
import { AdminShell } from '@/components/admin-shell';
import { StatusBadge } from '@/components/status-badge';
import { ActionButton } from '@/components/action-button';

export const metadata = { title: 'Withdrawals — RivlayX Admin' };

const PAGE_SIZE = 100;

const TONE: Record<string, 'green' | 'red' | 'yellow' | 'blue' | 'gray'> = {
  pending_review: 'yellow',
  approved: 'blue',
  processing: 'blue',
  paid: 'green',
  failed: 'red',
  fulfilled: 'green',
  rejected: 'red',
  cancelled: 'gray',
};

/**
 * Withdrawal review (Sprint 30/31). Lists requests; an admin approves or rejects
 * `pending_review` ones. Approval marks a request payable — during closed alpha
 * an admin still pays it out manually (no automatic on-chain payout is wired).
 * Approve/reject are guarded by the `approveWithdrawal` permission (admin + MFA).
 */
export default async function WithdrawalsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { user, roles } = await requireSession(getDb, {
    app: 'admin',
    minRole: 'admin',
    loginPath: '/login',
    mfaPath: '/mfa',
  });
  const statusFilter = (await searchParams).status;

  const db = getDb();
  const rows = await db
    .select({
      w: withdrawalRequests,
      email: users.email,
    })
    .from(withdrawalRequests)
    .leftJoin(users, eq(users.id, withdrawalRequests.userId))
    .orderBy(desc(withdrawalRequests.createdAt))
    .limit(PAGE_SIZE);

  const filtered = statusFilter ? rows.filter((r) => r.w.status === statusFilter) : rows;
  const pendingCount = rows.filter((r) => r.w.status === 'pending_review').length;
  const canApprove = can(roles, 'approveWithdrawal');

  return (
    <AdminShell user={user} roles={roles}>
      <h1 style={{ margin: 0 }}>Withdrawals</h1>
      <p style={{ marginTop: '0.5rem', opacity: 0.6, fontSize: 13 }}>
        {pendingCount} pending review. Verify available balance before paying out manually — nothing
        is held automatically.
      </p>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1.5rem' }}>
        <thead>
          <tr>
            <Th>Requested</Th>
            <Th>User</Th>
            <Th>Amount</Th>
            <Th>Destination</Th>
            <Th>Status</Th>
            <Th>Tx</Th>
            <Th>Actions</Th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr>
              <Td colSpan={7} style={{ opacity: 0.6 }}>
                No withdrawal requests.
              </Td>
            </tr>
          ) : (
            filtered.map((r) => (
              <tr key={r.w.id}>
                <Td>{new Date(r.w.createdAt).toISOString().slice(0, 19).replace('T', ' ')}</Td>
                <Td>{r.email ?? r.w.userId}</Td>
                <Td>{r.w.amountUsdc} USDC</Td>
                <Td>
                  <code style={{ fontSize: 12, wordBreak: 'break-all' }}>
                    {r.w.destinationWallet}
                  </code>
                </Td>
                <Td>
                  <StatusBadge label={r.w.status} tone={TONE[r.w.status] ?? 'gray'} />
                </Td>
                <Td>
                  {r.w.txSignature ? (
                    <code style={{ fontSize: 11 }}>{r.w.txSignature.slice(0, 14)}…</code>
                  ) : (
                    <span style={{ opacity: 0.4 }}>—</span>
                  )}
                </Td>
                <Td>
                  {canApprove && r.w.status === 'pending_review' ? (
                    <span style={{ display: 'flex', gap: 6 }}>
                      <ActionButton
                        endpoint={`/api/admin/withdrawals/${r.w.id}/approve`}
                        label="Approve"
                        confirmMessage={`Approve ${r.w.amountUsdc} USDC to ${r.w.destinationWallet}? You must then pay it out manually — nothing is sent automatically.`}
                      />
                      <ActionButton
                        endpoint={`/api/admin/withdrawals/${r.w.id}/reject`}
                        label="Reject"
                        tone="danger"
                        requireReason
                        confirmMessage={`Reject this ${r.w.amountUsdc} USDC withdrawal to ${r.w.destinationWallet}? This closes the request — the user must submit a new one.`}
                      />
                    </span>
                  ) : (
                    <span style={{ opacity: 0.4 }}>—</span>
                  )}
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
