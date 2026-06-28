import Link from 'next/link';
import type { marketplace } from '@rivlayx/core';
import {
  formatDateTime,
  formatUsdc,
  humanizeCategory,
  humanizeResolveType,
} from '@/lib/marketplace/format';
import { ShareLink } from './share-link';
import { StatusBadge } from './status-badge';
import { AcceptBetCard } from './accept-bet-card';
import { ReputationBadge } from '@/components/reputation/reputation-badge';
import { PageContainer } from '@/components/ui/page-container';

/** Signed-in viewer context, or `null` for anonymous visitors. */
export interface BetDetailViewer {
  userId: string;
  availableUsdc: string;
}

const card: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  padding: '1.1rem 1.25rem',
  background: '#fff',
  marginBottom: '1rem',
};
const label: React.CSSProperties = { fontSize: 12, opacity: 0.55, textTransform: 'uppercase', letterSpacing: 0.4 };

export function BetDetailView({
  bet,
  viewer = null,
}: {
  bet: marketplace.MarketplaceBetDetail;
  viewer?: BetDetailViewer | null;
}) {
  const isOpen = bet.status === 'OPEN';
  const expired = bet.expiresAt ? new Date(bet.expiresAt).getTime() <= Date.now() : false;
  const isCreator = viewer?.userId === bet.creatorUserId;
  return (
    <PageContainer size="md">
      <Link href="/bets" style={{ color: '#5b8def', fontSize: 13 }}>
        ← Back to marketplace
      </Link>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '1rem 0 0.4rem' }}>
        <span
          style={{
            fontSize: 11,
            padding: '2px 8px',
            borderRadius: 999,
            background: '#eef2ff',
            color: '#4458c7',
            fontWeight: 600,
          }}
        >
          {humanizeCategory(bet.category)}
        </span>
        <StatusBadge status={bet.status} />
        <span style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, opacity: 0.7 }}>
          Creator
          <ReputationBadge tier={bet.creatorTier} provisional={bet.creatorProvisional} size="sm" />
        </span>
      </div>
      <h1 style={{ margin: '0 0 0.25rem', fontSize: 24 }}>{bet.title}</h1>
      {bet.description ? <p style={{ marginTop: 0, opacity: 0.8 }}>{bet.description}</p> : null}

      <div style={card}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.9rem' }}>
          <div>
            <div style={label}>Stake / side</div>
            <div style={{ fontWeight: 600 }}>{formatUsdc(bet.stakePerSideUsdc)}</div>
          </div>
          <div>
            <div style={label}>Pot (matched)</div>
            <div style={{ fontWeight: 700 }}>{formatUsdc(bet.potUsdc)}</div>
          </div>
          <div>
            <div style={label}>Resolution</div>
            <div style={{ fontWeight: 600 }}>
              {humanizeResolveType(bet.resolveType)} · {bet.resolutionMethod}
            </div>
          </div>
          <div>
            <div style={label}>Created</div>
            <div>{formatDateTime(bet.createdAt)}</div>
          </div>
          <div>
            <div style={label}>Expires</div>
            <div>{formatDateTime(bet.expiresAt)}</div>
          </div>
          {bet.eventAt ? (
            <div>
              <div style={label}>Event</div>
              <div>{formatDateTime(bet.eventAt)}</div>
            </div>
          ) : null}
        </div>
      </div>

      <div style={card}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Rules</h2>
        <ol style={{ margin: 0, paddingLeft: '1.1rem' }}>
          {bet.rules.map((r) => (
            <li key={r.ruleIndex} style={{ marginBottom: 4 }}>
              {r.display}
            </li>
          ))}
        </ol>
      </div>

      <div style={card}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Participants</h2>
        <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
          {bet.participants.map((p, i) => (
            <li key={`${p.role}-${i}`} style={{ marginBottom: 4 }}>
              <strong style={{ textTransform: 'capitalize' }}>{p.role}</strong> — side{' '}
              <code>{p.side}</code> · {formatUsdc(p.stakeLockedUsdc)} locked
            </li>
          ))}
        </ul>
        {bet.participants.length < 2 ? (
          <p style={{ fontSize: 13, opacity: 0.65, marginBottom: 0 }}>
            Open side available — waiting for an acceptor.
          </p>
        ) : null}
      </div>

      <div style={card}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Share</h2>
        <ShareLink sharePath={bet.sharePath} />
      </div>

      {isOpen ? renderAcceptSection() : null}
    </PageContainer>
  );

  function renderAcceptSection() {
    if (!viewer) {
      return (
        <Link
          href="/login"
          style={{
            display: 'inline-block',
            padding: '0.6rem 1.2rem',
            borderRadius: 8,
            background: '#1f2937',
            color: '#fff',
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          Sign in to accept →
        </Link>
      );
    }
    if (isCreator) {
      return (
        <p style={{ fontSize: 14, opacity: 0.7 }}>
          This is your bet — waiting for someone to accept the open side.
        </p>
      );
    }
    if (expired) {
      return (
        <p style={{ fontSize: 14, color: '#b91c1c' }}>
          The open window for this bet has expired and it can no longer be accepted.
        </p>
      );
    }
    return (
      <AcceptBetCard
        betId={bet.id}
        stakeRequiredUsdc={bet.stakePerSideUsdc}
        potUsdc={bet.potUsdc}
        creatorSide={bet.creatorSide}
        availableUsdc={viewer.availableUsdc}
        templateSides={bet.templateSides}
      />
    );
  }
}
