import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { requireSession } from '@rivlayx/auth/next';
import { deposits as depositsTable, wallets } from '@rivlayx/db';
import { ledger } from '@rivlayx/core';
import { getDb } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { BalanceCard } from '@/components/wallet/balance-card';
import { DepositsTable } from '@/components/wallet/deposits-table';
import { truncateAddress } from '@/components/wallet/format';

export const metadata = { title: 'Wallet — RivlayX' };

export default async function WalletPage() {
  const env = getEnv();
  const { user } = await requireSession(getDb, { app: 'user', loginPath: '/login' });
  const db = getDb();

  const balance = await ledger.getBalance(db, user.id);
  const [primaryWallet] = await db
    .select()
    .from(wallets)
    .where(eq(wallets.userId, user.id))
    .limit(1);
  const recentDeposits = await db
    .select()
    .from(depositsTable)
    .where(eq(depositsTable.userId, user.id))
    .orderBy(desc(depositsTable.detectedAt))
    .limit(5);

  return (
    <main style={{ maxWidth: 880, margin: '2rem auto', padding: '0 1rem' }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '2rem',
        }}
      >
        <h1 style={{ margin: 0 }}>Wallet</h1>
        <Link
          href="/wallet/deposit"
          style={{
            background: '#5b8def',
            color: 'white',
            padding: '0.5rem 1rem',
            borderRadius: 6,
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          Deposit USDC →
        </Link>
      </header>

      <BalanceCard
        availableUsdc={balance?.availableUsdc ?? '0'}
        lockedUsdc={balance?.lockedUsdc ?? '0'}
      />

      <section style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: 18 }}>Linked Solana wallet</h2>
        {primaryWallet ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <code style={{ fontSize: 13, wordBreak: 'break-all' }}>{primaryWallet.address}</code>
            <span
              style={{
                background: '#13161a',
                border: '1px solid #2c3036',
                padding: '2px 8px',
                borderRadius: 4,
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: 0.4,
              }}
            >
              {primaryWallet.source.replace('_', ' ')}
            </span>
            <span style={{ fontSize: 12, opacity: 0.6 }}>
              Network: <code>{env.SOLANA_NETWORK}</code>
            </span>
          </div>
        ) : (
          <p style={{ opacity: 0.6 }}>No wallet linked yet.</p>
        )}
      </section>

      <section style={{ marginTop: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <h2 style={{ fontSize: 18, margin: 0 }}>Recent deposits</h2>
          <Link href="/wallet/deposits" style={{ color: '#5b8def', fontSize: 13 }}>
            View all →
          </Link>
        </div>
        <div style={{ marginTop: '1rem' }}>
          <DepositsTable
            deposits={recentDeposits}
            network={env.SOLANA_NETWORK}
            emptyMessage="No deposits yet. Click “Deposit USDC” to get started."
          />
        </div>
      </section>

      {primaryWallet && (
        <p style={{ marginTop: '2rem', fontSize: 12, opacity: 0.5 }}>
          Wallet: {truncateAddress(primaryWallet.address, 6, 6)}
        </p>
      )}
    </main>
  );
}
