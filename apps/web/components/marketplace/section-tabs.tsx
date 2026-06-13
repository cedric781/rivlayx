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
    <nav style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: '1.25rem' }}>
      {marketplace.marketplaceSectionValues.map((section) => {
        const isActive = section === active;
        return (
          <Link
            key={section}
            href={betsHref(searchParams, { section, page: undefined })}
            style={{
              padding: '0.45rem 0.9rem',
              borderRadius: 999,
              fontSize: 14,
              fontWeight: 600,
              textDecoration: 'none',
              background: isActive ? '#1f2937' : '#f3f4f6',
              color: isActive ? '#fff' : '#374151',
            }}
          >
            {LABELS[section]}
          </Link>
        );
      })}
    </nav>
  );
}
