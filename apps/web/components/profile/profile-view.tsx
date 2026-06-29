import type { profiles, reputation } from '@rivlayx/core';
import { formatDateTime } from '@/lib/marketplace/format';
import type { ParsedProfileParams } from '@/lib/profile/params';
import { ReputationBadge } from '@/components/reputation/reputation-badge';
import { ProfileStats } from './profile-stats';
import { BetHistory } from './bet-history';
import { PageContainer } from '@/components/ui/page-container';

/**
 * Shared profile renderer for `/profile` (self) and `/profile/[username]`
 * (public). Only public-safe fields are passed in — no email, privyId, or
 * wallet ever reaches this component.
 */
export function ProfileView({
  user,
  rep,
  stats,
  bets,
  params,
  basePath,
  isOwn,
}: {
  user: profiles.PublicUserSummary;
  rep: reputation.PublicReputation;
  stats: profiles.ProfileStats;
  bets: profiles.ListProfileBetsResult;
  params: ParsedProfileParams;
  basePath: string;
  isOwn: boolean;
}) {
  return (
    <PageContainer size="lg">
      <header style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <h1 style={{ margin: '0 0 0.2rem', fontSize: 'clamp(1.5rem, 4vw, 1.75rem)' }}>
            {user.displayName ?? `@${user.username}`}
          </h1>
          <ReputationBadge tier={rep.tier} provisional={rep.provisional} />
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, opacity: 0.6 }}>@{user.username}</span>
          <span style={{ fontSize: 13, opacity: 0.5 }}>Joined {formatDateTime(user.joinedAt)}</span>
          {isOwn ? (
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
              Your profile
            </span>
          ) : null}
        </div>
      </header>

      <ProfileStats stats={stats} />
      <BetHistory basePath={basePath} params={params} result={bets} />
    </PageContainer>
  );
}
