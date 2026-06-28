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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ marginBottom: 4, fontSize: 'clamp(1.5rem, 4vw, 2rem)' }}>Open bets</h1>
        <Link
          href="/bets/new"
          style={{
            padding: '0.5rem 1.1rem',
            borderRadius: 8,
            background: '#1f2937',
            color: '#fff',
            fontWeight: 600,
            textDecoration: 'none',
            fontSize: 14,
          }}
        >
          + Create bet
        </Link>
      </div>
      <p style={{ marginTop: 0, opacity: 0.6, fontSize: 14 }}>
        Browse open wagers. {result.total} match your filters.
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

  return (
    <div style={{ display: 'flex', justifyContent: 'center', gap: 12, alignItems: 'center', marginTop: '1.5rem' }}>
      {result.page > 1 ? (
        <Link href={betsHref(searchParams, { page: String(result.page - 1) })} style={{ color: '#5b8def' }}>
          ← Prev
        </Link>
      ) : (
        <span style={{ opacity: 0.3 }}>← Prev</span>
      )}
      <span style={{ fontSize: 13, opacity: 0.6 }}>
        Page {result.page} of {totalPages}
      </span>
      {result.hasMore ? (
        <Link href={betsHref(searchParams, { page: String(result.page + 1) })} style={{ color: '#5b8def' }}>
          Next →
        </Link>
      ) : (
        <span style={{ opacity: 0.3 }}>Next →</span>
      )}
    </div>
  );
}
