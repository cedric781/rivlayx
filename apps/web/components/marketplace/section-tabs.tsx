import Link from 'next/link';
import { marketplace } from '@rivlayx/core';
import { betsHref, type RawSearchParams } from '@/lib/marketplace/href';

const LABELS: Record<marketplace.MarketplaceSection, string> = {
  trending: 'Trending',
  newest: 'Newest',
  expiring_soon: 'Expiring Soon',
  highest_stakes: 'Highest Stakes',
};

export function SectionTabs({
  active,
  searchParams,
}: {
  active: marketplace.MarketplaceSection;
  searchParams: RawSearchParams;
}) {
  return (
    <nav
      aria-label="Marketplace sections"
      style={{
        display: 'flex',
        gap: 'var(--rx-space-2)',
        marginBottom: 'var(--rx-space-5)',
        // Single scannable row that scrolls horizontally on narrow screens.
        overflowX: 'auto',
        paddingBottom: 'var(--rx-space-1)',
        WebkitOverflowScrolling: 'touch',
        scrollbarWidth: 'none',
      }}
    >
      {marketplace.marketplaceSectionValues.map((section) => {
        const isActive = section === active;
        return (
          <Link
            key={section}
            href={betsHref(searchParams, { section, page: undefined })}
            aria-current={isActive ? 'page' : undefined}
            style={{
              flex: '0 0 auto',
              padding: '0.45rem 0.95rem',
              borderRadius: 'var(--rx-radius-pill)',
              fontSize: 'var(--rx-font-size-base)',
              fontWeight: 'var(--rx-font-weight-semibold)',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
              background: isActive ? 'var(--rx-color-primary)' : 'var(--rx-color-surface-2)',
              color: isActive ? 'var(--rx-color-primary-contrast)' : 'var(--rx-color-text-muted)',
              border: `1px solid ${isActive ? 'var(--rx-color-primary)' : 'var(--rx-color-border)'}`,
            }}
          >
            {LABELS[section]}
          </Link>
        );
      })}
    </nav>
  );
}
