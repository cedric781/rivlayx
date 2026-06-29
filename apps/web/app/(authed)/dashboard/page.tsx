import Link from 'next/link';
import type { ReactNode } from 'react';
import { eq } from 'drizzle-orm';
import { requireSession } from '@rivlayx/auth/next';
import { wallets } from '@rivlayx/db';
import { ledger, profiles } from '@rivlayx/core';
import { getDb } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { formatUsdc } from '@/lib/format';
import { formatExpiry } from '@/lib/marketplace/format';
import { truncateAddress } from '@/components/wallet/format';
import { PageContainer } from '@/components/ui/page-container';
import { BalanceCard } from '@/components/wallet/balance-card';
import { Stat } from '@/components/ui/stat';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusBadge } from '@/components/marketplace/status-badge';
import { IconInbox } from '@/components/ui/icons';
import { LogoutButton } from './logout-button';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboard — RivlayX' };

const RESULT_TONE: Record<profiles.ProfileBetResult, string> = {
  won: 'var(--rx-color-success-fg)',
  lost: 'var(--rx-color-danger-fg)',
  void: 'var(--rx-color-text-faint)',
  pending: 'var(--rx-color-warning-fg)',
};

const RESULT_LABEL: Record<profiles.ProfileBetResult, string> = {
  won: 'Won',
  lost: 'Lost',
  void: 'Void',
  pending: 'In progress',
};

export default async function DashboardPage() {
  const env = getEnv();
  const { user, roles } = await requireSession(getDb, { app: 'user', loginPath: '/login' });
  const db = getDb();

  const [summary, balance, stats, recent, walletRow] = await Promise.all([
    profiles.getPublicUserById(db, user.id),
    ledger.getBalance(db, user.id),
    profiles.getProfileStats(db, user.id),
    profiles.listProfileBets(db, user.id, { sort: 'newest', pageSize: 5 }),
    db
      .select()
      .from(wallets)
      .where(eq(wallets.userId, user.id))
      .limit(1)
      .then((rows) => rows[0]),
  ]);

  const displayName = summary?.displayName || summary?.username || user.email;
  const winRatePct = Math.round((stats.winRate ?? 0) * 100);
  const decided = stats.wins + stats.losses;

  return (
    <PageContainer size="lg">
      {/* ── Header ─────────────────────────────────────────────── */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          gap: 'var(--rx-space-4)',
          flexWrap: 'wrap',
          paddingBottom: 'var(--rx-space-5)',
          borderBottom: '1px solid var(--rx-color-border)',
        }}
      >
        <div style={{ minWidth: 0 }}>
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
            Dashboard
          </p>
          <h1
            style={{
              margin: 'var(--rx-space-1) 0 0',
              fontSize: 'clamp(1.5rem, 4vw, 2rem)',
              lineHeight: 'var(--rx-line-tight)',
              overflowWrap: 'anywhere',
            }}
          >
            Welcome back, {displayName}
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 'var(--rx-space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
          <Link href="/bets/new" style={primaryAction}>
            + Create bet
          </Link>
          <LogoutButton />
        </div>
      </header>

      {/* ── Balance + quick actions ────────────────────────────── */}
      <div
        style={{
          marginTop: 'var(--rx-space-6)',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 'var(--rx-space-4)',
          alignItems: 'stretch',
        }}
      >
        <BalanceCard
          availableUsdc={balance?.availableUsdc ?? '0'}
          lockedUsdc={balance?.lockedUsdc ?? '0'}
        />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 'var(--rx-space-3)',
          }}
        >
          <QuickAction href="/wallet/deposit" label="Deposit" hint="Add USDC" accent />
          <QuickAction href="/wallet/withdraw" label="Withdraw" hint="Cash out" />
          <QuickAction href="/bets" label="Browse bets" hint="Find a wager" />
          <QuickAction href="/profile" label="My profile" hint="Stats & history" />
        </div>
      </div>

      {/* ── Active-bets summary ────────────────────────────────── */}
      <section style={{ marginTop: 'var(--rx-space-6)' }}>
        <SectionHeading title="At a glance" />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            gap: 'var(--rx-space-3)',
          }}
        >
          <Stat label="Open" value={stats.openBets} hint="Awaiting an opponent" />
          <Stat label="Active" value={stats.activeBets} hint="Matched & live" />
          <Stat
            label="Win rate"
            value={`${winRatePct}%`}
            hint={decided > 0 ? `${stats.wins}W · ${stats.losses}L` : 'No settled bets yet'}
            accent={decided > 0 ? 'var(--rx-color-success-fg)' : undefined}
          />
          <Stat label="Volume" value={formatUsdc(stats.totalVolumeUsdc)} hint="Lifetime staked" />
        </div>
      </section>

      {/* ── Recent activity ────────────────────────────────────── */}
      <section style={{ marginTop: 'var(--rx-space-6)' }}>
        <SectionHeading title="Recent activity" action={<Link href="/profile" style={linkStyle}>View all →</Link>} />
        {recent.items.length === 0 ? (
          <EmptyState
            icon={<IconInbox width={32} height={32} />}
            title="No bets yet"
            hint="Your most recent bets will show up here once you create or accept one."
            action={
              <Link href="/bets/new" style={primaryAction}>
                + Create your first bet
              </Link>
            }
          />
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--rx-space-2)' }}>
            {recent.items.map((bet) => (
              <li key={bet.id}>
                <Link
                  href={bet.sharePath}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 'var(--rx-space-3)',
                    padding: 'var(--rx-space-3) var(--rx-space-4)',
                    background: 'var(--rx-color-surface)',
                    border: '1px solid var(--rx-color-border)',
                    borderRadius: 'var(--rx-radius-lg)',
                    textDecoration: 'none',
                    color: 'inherit',
                  }}
                >
                  <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--rx-space-1)' }}>
                    <span
                      style={{
                        fontWeight: 'var(--rx-font-weight-semibold)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {bet.title}
                    </span>
                    <span style={{ display: 'flex', gap: 'var(--rx-space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                      <StatusBadge status={bet.status} />
                      <span style={{ fontSize: 'var(--rx-font-size-xs)', color: 'var(--rx-color-text-faint)' }}>
                        {formatExpiry(bet.expiresAt)}
                      </span>
                    </span>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontWeight: 'var(--rx-font-weight-semibold)', fontSize: 'var(--rx-font-size-sm)' }}>
                      {formatUsdc(bet.userStakeUsdc)}
                    </div>
                    <div style={{ fontSize: 'var(--rx-font-size-xs)', color: RESULT_TONE[bet.result], fontWeight: 'var(--rx-font-weight-semibold)' }}>
                      {RESULT_LABEL[bet.result]}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Account details ────────────────────────────────────── */}
      <section style={{ marginTop: 'var(--rx-space-6)' }}>
        <SectionHeading title="Account" />
        <div
          style={{
            background: 'var(--rx-color-surface)',
            border: '1px solid var(--rx-color-border)',
            borderRadius: 'var(--rx-radius-xl)',
            padding: 'var(--rx-space-4) var(--rx-space-5)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--rx-space-3)',
          }}
        >
          <DetailRow label="Email" value={<code style={{ fontSize: 'var(--rx-font-size-sm)' }}>{user.email}</code>} />
          <DetailRow
            label="Roles"
            value={
              <span style={{ fontSize: 'var(--rx-font-size-sm)' }}>
                {roles.length > 0 ? roles.join(', ') : 'Member'}
              </span>
            }
          />
          <DetailRow
            label="Wallet"
            value={
              walletRow ? (
                <span style={{ display: 'flex', gap: 'var(--rx-space-2)', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <code style={{ fontSize: 'var(--rx-font-size-sm)' }}>{truncateAddress(walletRow.address, 6, 6)}</code>
                  <span style={{ fontSize: 'var(--rx-font-size-xs)', color: 'var(--rx-color-text-faint)' }}>
                    {env.SOLANA_NETWORK}
                  </span>
                </span>
              ) : (
                <Link href="/wallet" style={linkStyle}>
                  Link a wallet →
                </Link>
              )
            }
          />
        </div>
      </section>
    </PageContainer>
  );
}

const primaryAction: React.CSSProperties = {
  padding: '0.55rem 1.2rem',
  borderRadius: 'var(--rx-radius-lg)',
  background: 'var(--rx-color-primary)',
  color: 'var(--rx-color-primary-contrast)',
  fontWeight: 'var(--rx-font-weight-semibold)',
  textDecoration: 'none',
  fontSize: 'var(--rx-font-size-base)',
  whiteSpace: 'nowrap',
};

const linkStyle: React.CSSProperties = {
  color: 'var(--rx-color-primary)',
  fontSize: 'var(--rx-font-size-sm)',
  textDecoration: 'none',
  fontWeight: 'var(--rx-font-weight-semibold)',
};

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

function QuickAction({
  href,
  label,
  hint,
  accent,
}: {
  href: string;
  label: string;
  hint: string;
  accent?: boolean;
}) {
  return (
    <Link
      href={href}
      className="rx-card--interactive"
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 'var(--rx-space-1)',
        padding: 'var(--rx-space-4)',
        borderRadius: 'var(--rx-radius-lg)',
        textDecoration: 'none',
        background: accent ? 'var(--rx-color-info-surface)' : 'var(--rx-color-surface)',
        border: `1px solid ${accent ? 'var(--rx-color-info-border)' : 'var(--rx-color-border)'}`,
        color: 'var(--rx-color-text)',
      }}
    >
      <span style={{ fontWeight: 'var(--rx-font-weight-semibold)' }}>{label}</span>
      <span style={{ fontSize: 'var(--rx-font-size-xs)', color: 'var(--rx-color-text-muted)' }}>{hint}</span>
    </Link>
  );
}

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--rx-space-3)',
        flexWrap: 'wrap',
      }}
    >
      <span style={{ fontSize: 'var(--rx-font-size-sm)', color: 'var(--rx-color-text-muted)' }}>{label}</span>
      <span style={{ textAlign: 'right', minWidth: 0 }}>{value}</span>
    </div>
  );
}
