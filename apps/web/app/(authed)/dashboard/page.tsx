import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { requireSession } from '@rivlayx/auth/next';
import { wallets } from '@rivlayx/db';
import { getDb } from '@/lib/db';
import { PageContainer } from '@/components/ui/page-container';
import { LogoutButton } from './logout-button';

export const metadata = { title: 'Dashboard — RivlayX' };

export default async function DashboardPage() {
  const { user, roles } = await requireSession(getDb, { app: 'user', loginPath: '/login' });
  const [wallet] = await getDb().select().from(wallets).where(eq(wallets.userId, user.id)).limit(1);

  return (
    <PageContainer size="md">
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 'var(--rx-space-3)',
          flexWrap: 'wrap',
          borderBottom: '1px solid #2c3036',
          paddingBottom: '1rem',
        }}
      >
        <h1 style={{ margin: 0, fontSize: 'clamp(1.5rem, 4vw, 2rem)' }}>Dashboard</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <Link
            href="/bets/new"
            style={{
              padding: '0.5rem 1.1rem',
              borderRadius: 8,
              background: '#1f2937',
              color: '#fff',
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            + Create bet
          </Link>
          <LogoutButton />
        </div>
      </header>

      <section style={{ marginTop: '2rem' }}>
        <h2>Account</h2>
        <p>
          Email: <code>{user.email}</code>
        </p>
        <p>Roles: {roles.length > 0 ? roles.join(', ') : '<none>'}</p>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2>Wallet (placeholder)</h2>
        {wallet ? (
          <>
            <p>
              Address: <code style={{ wordBreak: 'break-all' }}>{wallet.address}</code>
            </p>
            <p>Chain: {wallet.chain}</p>
            <p>
              Source: <code>{wallet.source}</code>
            </p>
          </>
        ) : (
          <p>No wallet linked.</p>
        )}
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h2>Balance (placeholder)</h2>
        <p>Available: 0.000000 USDC</p>
        <p>Locked: 0.000000 USDC</p>
        <p style={{ fontSize: 12, opacity: 0.6 }}>Ledger and deposit flow arrive in Sprint 2.</p>
      </section>
    </PageContainer>
  );
}
