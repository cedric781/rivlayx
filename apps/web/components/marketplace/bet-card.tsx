import Link from 'next/link';
import type { marketplace } from '@rivlayx/core';
import { formatExpiry, formatUsdc, humanizeCategory, humanizeResolveType } from '@/lib/marketplace/format';
import { ReputationBadge } from '@/components/reputation/reputation-badge';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/marketplace/status-badge';

export function BetCard({ bet }: { bet: marketplace.MarketplaceListItem }) {
  return (
    <Link
      href={`/bets/${bet.shortCode}`}
      style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}
    >
      <Card interactive style={{ display: 'flex', flexDirection: 'column', gap: 'var(--rx-space-3)' }}>
        {/* Status + category, with expiry pushed right */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 'var(--rx-space-2)',
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', gap: 'var(--rx-space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
            <StatusBadge status={bet.status} />
            <Badge tone="accent">{humanizeCategory(bet.category)}</Badge>
          </div>
          <span
            style={{ fontSize: 'var(--rx-font-size-xs)', color: 'var(--rx-color-neutral-fg)' }}
          >
            {formatExpiry(bet.expiresAt)}
          </span>
        </div>

        {/* Title */}
        <h3
          className="rx-clamp-2"
          title={bet.title}
          style={{
            margin: 0,
            fontSize: 'var(--rx-font-size-md)',
            fontWeight: 700,
            lineHeight: 'var(--rx-line-snug)',
          }}
        >
          {bet.title}
        </h3>

        {/* Creator reputation */}
        <div style={{ display: 'flex', gap: 'var(--rx-space-2)', alignItems: 'center' }}>
          <span style={{ fontSize: 'var(--rx-font-size-xs)', color: 'var(--rx-color-neutral-fg)' }}>
            Creator
          </span>
          <ReputationBadge tier={bet.creatorTier} provisional={bet.creatorProvisional} size="sm" />
        </div>

        {/* Stake + payout — the primary information */}
        <div
          style={{
            display: 'flex',
            gap: 'var(--rx-space-4)',
            flexWrap: 'wrap',
            borderTop: '1px solid var(--rx-color-paper-border-muted)',
            paddingTop: 'var(--rx-space-3)',
          }}
        >
          <Metric label="Stake / side" value={formatUsdc(bet.stakePerSideUsdc)} />
          <Metric label="Winner takes" value={formatUsdc(bet.potUsdc)} emphasis />
        </div>

        {/* Resolution method */}
        <div style={{ fontSize: 'var(--rx-font-size-xs)', color: 'var(--rx-color-neutral-fg)' }}>
          {humanizeResolveType(bet.resolveType)} resolution
        </div>
      </Card>
    </Link>
  );
}

function Metric({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontSize: 'var(--rx-font-size-xs)',
          color: 'var(--rx-color-neutral-fg)',
          textTransform: 'uppercase',
          letterSpacing: 'var(--rx-letter-spacing-wide)',
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: 'var(--rx-space-1)',
          fontSize: emphasis ? 'var(--rx-font-size-lg)' : 'var(--rx-font-size-base)',
          fontWeight: emphasis ? 700 : 600,
          color: emphasis ? 'var(--rx-color-accent)' : 'var(--rx-color-paper-ink)',
        }}
      >
        {value}
      </div>
    </div>
  );
}
