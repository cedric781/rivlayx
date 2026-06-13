import Link from 'next/link';
import type { marketplace } from '@rivlayx/core';
import { formatExpiry, formatUsdc, humanizeCategory, humanizeResolveType } from '@/lib/marketplace/format';

const chip: React.CSSProperties = {
  display: 'inline-block',
  fontSize: 11,
  padding: '2px 8px',
  borderRadius: 999,
  background: '#eef2ff',
  color: '#4458c7',
  fontWeight: 600,
};

export function BetCard({ bet }: { bet: marketplace.MarketplaceListItem }) {
  return (
    <Link
      href={`/bets/${bet.shortCode}`}
      style={{
        display: 'block',
        textDecoration: 'none',
        color: 'inherit',
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        padding: '1rem',
        background: '#fff',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
        <span style={chip}>{humanizeCategory(bet.category)}</span>
        <span style={{ fontSize: 12, opacity: 0.6 }}>{formatExpiry(bet.expiresAt)}</span>
      </div>

      <h3 style={{ margin: '0.6rem 0 0.8rem', fontSize: 16, lineHeight: 1.35 }}>{bet.title}</h3>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem 1.2rem', fontSize: 13 }}>
        <Field label="Stake / side" value={formatUsdc(bet.stakePerSideUsdc)} />
        <Field label="Pot" value={formatUsdc(bet.potUsdc)} strong />
        <Field label="Resolve" value={humanizeResolveType(bet.resolveType)} />
      </div>
    </Link>
  );
}

function Field({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <span>
      <span style={{ opacity: 0.55 }}>{label}: </span>
      <span style={{ fontWeight: strong ? 700 : 500 }}>{value}</span>
    </span>
  );
}
