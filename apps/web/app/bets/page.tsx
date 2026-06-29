import { Suspense } from 'react';
import Link from 'next/link';
import { marketplace } from '@rivlayx/core';
import { getDb } from '@/lib/db';
import { parseMarketplaceParams } from '@/lib/marketplace/params';
import { betsHref, type RawSearchParams } from '@/lib/marketplace/href';
import { SectionTabs } from '@/components/marketplace/section-tabs';
import { MarketplaceFilters } from '@/components/marketplace/marketplace-filters';
import { BetCard } from '@/components/marketplace/bet-card';
import { PageContainer } from '@/components/ui/page-container';
import { EmptyState } from '@/components/ui/empty-state';
import { IconSearch } from '@/components/ui/icons';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Open bets — RivlayX' };

export default async function BetsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const sp = await searchParams;
  const params = parseMarketplaceParams(sp);
  const section = params.section ?? 'newest';
  const hasFilters = Boolean(
    sp['q'] ||
      sp['category'] ||
      sp['sport'] ||
      sp['resolveType'] ||
      sp['tier'] ||
      sp['minStake'] ||
      sp['maxStake'],
  );

  const db = getDb();
  const result = await marketplace.listMarketplaceBets(db, params);

  return (
    <PageContainer size="xl">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 'var(--rx-space-4)', flexWrap: 'wrap' }}>
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
            Marketplace
          </p>
          <h1 style={{ margin: 'var(--rx-space-1) 0 0', fontSize: 'clamp(1.5rem, 4vw, 2rem)', lineHeight: 'var(--rx-line-tight)' }}>
            Open bets
          </h1>
        </div>
        <Link
          href="/bets/new"
          style={{
            padding: '0.55rem 1.2rem',
            borderRadius: 'var(--rx-radius-lg)',
            background: 'var(--rx-color-primary)',
            color: 'var(--rx-color-primary-contrast)',
            fontWeight: 'var(--rx-font-weight-semibold)',
            textDecoration: 'none',
            fontSize: 'var(--rx-font-size-base)',
            whiteSpace: 'nowrap',
          }}
        >
          + Create bet
        </Link>
      </div>
      <p style={{ margin: 'var(--rx-space-2) 0 var(--rx-space-5)', color: 'var(--rx-color-text-muted)', fontSize: 'var(--rx-font-size-base)' }}>
        Browse open wagers —{' '}
        <strong style={{ color: 'var(--rx-color-text)', fontWeight: 'var(--rx-font-weight-semibold)' }}>
          {result.total}
        </strong>{' '}
        {result.total === 1 ? 'bet matches' : 'bets match'} your filters.
      </p>

      <SectionTabs active={section} searchParams={sp} />
      <Suspense fallback={null}>
        <MarketplaceFilters />
      </Suspense>

      {result.items.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<IconSearch width={32} height={32} />}
            title="No bets match your filters"
            hint="Try widening or clearing your filters to see more open bets."
          />
        ) : (
          <EmptyState
            icon={<IconSearch width={32} height={32} />}
            title="No open bets yet"
            hint="There are no open bets right now — be the first to create one."
            action={
              <Link
                href="/bets/new"
                style={{
                  display: 'inline-block',
                  padding: '0.55rem 1.3rem',
                  borderRadius: 'var(--rx-radius-lg)',
                  background: 'var(--rx-color-cta)',
                  color: 'var(--rx-color-cta-contrast)',
                  fontWeight: 600,
                  textDecoration: 'none',
                }}
              >
                + Create bet
              </Link>
            }
          />
        )
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: '1rem',
          }}
        >
          {result.items.map((bet) => (
            <BetCard key={bet.id} bet={bet} />
          ))}
        </div>
      )}

      <Pagination result={result} searchParams={sp} />
    </PageContainer>
  );
}

function Pagination({
  result,
  searchParams,
}: {
  result: marketplace.ListBetsResult;
  searchParams: RawSearchParams;
}) {
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  if (totalPages <= 1) return null;

  const pageLink: React.CSSProperties = {
    color: 'var(--rx-color-primary)',
    textDecoration: 'none',
    fontWeight: 'var(--rx-font-weight-semibold)',
    fontSize: 'var(--rx-font-size-sm)',
  };
  const pageDisabled: React.CSSProperties = {
    color: 'var(--rx-color-text-faint)',
    opacity: 0.5,
    fontSize: 'var(--rx-font-size-sm)',
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: 'var(--rx-space-4)', alignItems: 'center', marginTop: 'var(--rx-space-6)' }}>
      {result.page > 1 ? (
        <Link href={betsHref(searchParams, { page: String(result.page - 1) })} style={pageLink}>
          ← Prev
        </Link>
      ) : (
        <span style={pageDisabled}>← Prev</span>
      )}
      <span style={{ fontSize: 'var(--rx-font-size-sm)', color: 'var(--rx-color-text-muted)' }}>
        Page {result.page} of {totalPages}
      </span>
      {result.hasMore ? (
        <Link href={betsHref(searchParams, { page: String(result.page + 1) })} style={pageLink}>
          Next →
        </Link>
      ) : (
        <span style={pageDisabled}>Next →</span>
      )}
    </div>
  );
}
