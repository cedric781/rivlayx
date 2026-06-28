import Link from 'next/link';
import type { ReactNode } from 'react';
import { desc, eq } from 'drizzle-orm';
import { requireSession } from '@rivlayx/auth/next';
import { deposits as depositsTable, wallets } from '@rivlayx/db';
import { ledger } from '@rivlayx/core';
import { getDb } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { BalanceCard } from '@/components/wallet/balance-card';
import { DepositsTable } from '@/components/wallet/deposits-table';
import { PageContainer } from '@/components/ui/page-container';
import { IconArrowDownCircle, IconArrowUpCircle } from '@/components/ui/icons';

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
    <PageContainer size="lg">
      <header style={{ marginBottom: 'var(--rx-space-5)' }}>
        <p
          style={{
            margin: 0,
            fontSize: 'var(--rx-font-size-xs)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--rx-letter-spacing-wide)',
            color: 'var(--rx-color-text-muted)',
            fontWeight: 'var(--rx-font-weight-semibold)',
          }}
        >
          Wallet
        </p>
        <h1 style={{ margin: 'var(--rx-space-1) 0 0', fontSize: 'clamp(1.5rem, 4vw, 2rem)', lineHeight: 'var(--rx-line-tight)' }}>
          Your balance
        </h1>
      </header>

      <BalanceCard
        availableUsdc={balance?.availableUsdc ?? '0'}
        lockedUsdc={balance?.lockedUsdc ?? '0'}
      />

      {/* ── Deposit / withdraw entry points ────────────────────── */}
      <div
        style={{
          marginTop: 'var(--rx-space-4)',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 'var(--rx-space-3)',
        }}
      >
        <ActionCard
          href="/wallet/deposit"
          icon={<IconArrowDownCircle width={22} height={22} />}
          title="Deposit USDC"
          description="Send USDC on Solana to fund your balance. Detected automatically on-chain."
          cta="Deposit →"
          accent
        />
        <ActionCard
          href="/wallet/withdraw"
          icon={<IconArrowUpCircle width={22} height={22} />}
          title="Withdraw"
          description="Request a payout of your available balance to your Solana wallet."
          cta="Withdraw →"
        />
      </div>

      {/* ── Linked wallet ──────────────────────────────────────── */}
      <section style={{ marginTop: 'var(--rx-space-6)' }}>
        <SectionHeading title="Linked Solana wallet" />
        <div
          style={{
            background: 'var(--rx-color-surface)',
            border: '1px solid var(--rx-color-border)',
            borderRadius: 'var(--rx-radius-xl)',
            padding: 'var(--rx-space-4) var(--rx-space-5)',
          }}
        >
          {primaryWallet ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--rx-space-2)' }}>
              <code style={{ fontSize: 'var(--rx-font-size-sm)', wordBreak: 'break-all', color: 'var(--rx-color-text)' }}>
                {primaryWallet.address}
              </code>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--rx-space-3)', flexWrap: 'wrap' }}>
                <span
                  style={{
                    background: 'var(--rx-color-surface-2)',
                    border: '1px solid var(--rx-color-border)',
                    padding: '2px 8px',
                    borderRadius: 'var(--rx-radius-sm)',
                    fontSize: 'var(--rx-font-size-xs)',
                    textTransform: 'uppercase',
                    letterSpacing: 'var(--rx-letter-spacing-wide)',
                    color: 'var(--rx-color-text-muted)',
                  }}
                >
                  {primaryWallet.source.replace('_', ' ')}
                </span>
                <span style={{ fontSize: 'var(--rx-font-size-xs)', color: 'var(--rx-color-text-faint)' }}>
                  Network: <code>{env.SOLANA_NETWORK}</code>
                </span>
              </div>
            </div>
          ) : (
            <p style={{ margin: 0, color: 'var(--rx-color-text-muted)' }}>No wallet linked yet.</p>
          )}
        </div>
      </section>

      {/* ── Recent deposits ────────────────────────────────────── */}
      <section style={{ marginTop: 'var(--rx-space-6)' }}>
        <SectionHeading
          title="Recent deposits"
          action={
            <Link
              href="/wallet/deposits"
              style={{ color: 'var(--rx-color-primary)', fontSize: 'var(--rx-font-size-sm)', textDecoration: 'none', fontWeight: 'var(--rx-font-weight-semibold)' }}
            >
              View all →
            </Link>
          }
        />
        <DepositsTable
          deposits={recentDeposits}
          network={env.SOLANA_NETWORK}
          emptyMessage="No deposits yet. Use “Deposit USDC” above to get started."
        />
      </section>
    </PageContainer>
  );
}

function SectionHeading({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 'var(--rx-space-3)',
        marginBottom: 'var(--rx-space-3)',
      }}
    >
      <h2 style={{ margin: 0, fontSize: 'var(--rx-font-size-lg)' }}>{title}</h2>
      {action}
    </div>
  );
}

function ActionCard({
  href,
  icon,
  title,
  description,
  cta,
  accent,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  description: string;
  cta: string;
  accent?: boolean;
}) {
  return (
    <Link
      href={href}
      className="rx-card--interactive"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--rx-space-2)',
        padding: 'var(--rx-space-5)',
        borderRadius: 'var(--rx-radius-xl)',
        textDecoration: 'none',
        background: accent ? 'var(--rx-color-info-surface)' : 'var(--rx-color-surface)',
        border: `1px solid ${accent ? 'var(--rx-color-info-border)' : 'var(--rx-color-border)'}`,
        color: 'var(--rx-color-text)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--rx-space-2)' }}>
        <span aria-hidden="true" style={{ display: 'inline-flex', color: 'var(--rx-color-primary)' }}>
          {icon}
        </span>
        <span style={{ fontSize: 'var(--rx-font-size-md)', fontWeight: 'var(--rx-font-weight-semibold)' }}>{title}</span>
      </div>
      <p style={{ margin: 0, fontSize: 'var(--rx-font-size-sm)', color: 'var(--rx-color-text-muted)', lineHeight: 'var(--rx-line-snug)' }}>
        {description}
      </p>
      <span style={{ marginTop: 'var(--rx-space-1)', fontSize: 'var(--rx-font-size-sm)', fontWeight: 'var(--rx-font-weight-semibold)', color: 'var(--rx-color-primary)' }}>
        {cta}
      </span>
    </Link>
  );
}
