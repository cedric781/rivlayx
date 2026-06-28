import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { requireSession } from '@rivlayx/auth/next';
import { wallets, withdrawalRequests } from '@rivlayx/db';
import { ledger } from '@rivlayx/core';
import { getDb } from '@/lib/db';
import { formatUsdc } from '@/lib/format';
import { WithdrawForm } from '@/components/wallet/withdraw-form';
import { PageContainer } from '@/components/ui/page-container';
import { TableScroll } from '@/components/ui/table-scroll';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Withdraw — RivlayX' };

const STATUS_LABEL: Record<string, string> = {
  pending_review: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected',
  fulfilled: 'Fulfilled',
  cancelled: 'Cancelled',
};

/**
 * Withdraw screen (Sprint 30). Shows available balance, the request form, and
 * the user's recent requests. Submitting records a `pending_review` request —
 * an admin reviews and pays out manually; no automatic on-chain transfer.
 */
export default async function WithdrawPage() {
  const { user } = await requireSession(getDb, { app: 'user', loginPath: '/login' });
  const db = getDb();

  const balance = await ledger.getBalance(db, user.id);
  const [primaryWallet] = await db
    .select()
    .from(wallets)
    .where(eq(wallets.userId, user.id))
    .limit(1);
  const requests = await db
    .select()
    .from(withdrawalRequests)
    .where(eq(withdrawalRequests.userId, user.id))
    .orderBy(desc(withdrawalRequests.createdAt))
    .limit(10);

  return (
    <PageContainer size="sm">
      <Link href="/wallet" style={{ color: '#5b8def', fontSize: 13 }}>
        ← Back to wallet
      </Link>
      <h1 style={{ marginBottom: 4 }}>Withdraw USDC</h1>
      <p style={{ marginTop: 0, opacity: 0.6, fontSize: 14 }}>
        Request a withdrawal of your available balance. Requests are reviewed and paid out manually
        by an admin during closed alpha.
      </p>

      <WithdrawForm
        availableUsdc={balance?.availableUsdc ?? '0'}
        defaultWallet={primaryWallet?.address ?? ''}
      />

      <section style={{ marginTop: '2.5rem' }}>
        <h2 style={{ fontSize: 16 }}>Your requests</h2>
        {requests.length === 0 ? (
          <p style={{ opacity: 0.6, fontSize: 13 }}>No withdrawal requests yet.</p>
        ) : (
          <TableScroll>
          <table style={{ width: '100%', minWidth: 480, borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', opacity: 0.6 }}>
                <th style={{ padding: '0.4rem 0' }}>Requested</th>
                <th>Amount</th>
                <th>Destination</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id} style={{ borderTop: '1px solid #e5e7eb' }}>
                  <td style={{ padding: '0.4rem 0' }}>
                    {new Date(r.createdAt).toISOString().slice(0, 16).replace('T', ' ')}
                  </td>
                  <td>{formatUsdc(r.amountUsdc)}</td>
                  <td>
                    <code style={{ fontSize: 12 }}>
                      {r.destinationWallet.slice(0, 6)}…{r.destinationWallet.slice(-6)}
                    </code>
                  </td>
                  <td>{STATUS_LABEL[r.status] ?? r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </TableScroll>
        )}
      </section>
    </PageContainer>
  );
}
