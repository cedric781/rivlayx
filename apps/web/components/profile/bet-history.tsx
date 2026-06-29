import Link from 'next/link';
import { profiles } from '@rivlayx/core';
import { formatDateTime, formatUsdc, humanizeResolveType } from '@/lib/marketplace/format';
import { StatusBadge } from '@/components/marketplace/status-badge';
import { buildProfileHref, type ParsedProfileParams } from '@/lib/profile/params';
import { EmptyState } from '@/components/ui/empty-state';
import { IconInbox } from '@/components/ui/icons';

const FILTER_LABELS: Record<profiles.ProfileBetFilter, string> = {
  open: 'Open',
  active: 'Active',
  awaiting: 'Awaiting Result',
  disputed: 'Disputed',
  won: 'Won',
  lost: 'Lost',
  all: 'All',
};

const SORT_LABELS: Record<profiles.ProfileBetSort, string> = {
  newest: 'Newest',
  oldest: 'Oldest',
  highest_stake: 'Highest Stake',
  highest_pot: 'Highest Pot',
};

const RESULT_STYLE: Record<profiles.ProfileBetResult, { label: string; color: string }> = {
  won: { label: 'Won', color: '#15803d' },
  lost: { label: 'Lost', color: '#b91c1c' },
  void: { label: 'Void', color: '#64748b' },
  pending: { label: 'In progress', color: '#a16207' },
};

export function BetHistory({
  basePath,
  params,
  result,
}: {
  basePath: string;
  params: ParsedProfileParams;
  result: profiles.ListProfileBetsResult;
}) {
  return (
    <section>
      <h2 style={{ fontSize: 18 }}>Bet history</h2>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        {profiles.profileBetFilterValues.map((f) => {
          const active = params.filter === f;
          return (
            <Link
              key={f}
              href={buildProfileHref(basePath, params, { filter: f, page: 1 })}
              style={{
                fontSize: 13,
                padding: '4px 10px',
                borderRadius: 999,
                textDecoration: 'none',
                border: active ? '1px solid #4458c7' : '1px solid #e5e7eb',
                background: active ? '#eef2ff' : '#fff',
                color: active ? '#4458c7' : '#374151',
                fontWeight: active ? 700 : 500,
              }}
            >
              {FILTER_LABELS[f]}
            </Link>
          );
        })}
      </div>

      {/* Sort control */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          marginBottom: '1rem',
          fontSize: 13,
        }}
      >
        <span style={{ opacity: 0.55 }}>Sort:</span>
        {profiles.profileBetSortValues.map((s) => {
          const active = params.sort === s;
          return (
            <Link
              key={s}
              href={buildProfileHref(basePath, params, { sort: s, page: 1 })}
              style={{
                textDecoration: active ? 'underline' : 'none',
                color: active ? '#1f2937' : '#5b8def',
                fontWeight: active ? 700 : 500,
              }}
            >
              {SORT_LABELS[s]}
            </Link>
          );
        })}
      </div>

      {/* List */}
      {result.items.length === 0 ? (
        <EmptyState
          icon={<IconInbox width={32} height={32} />}
          title="No bets in this view"
          hint="Try a different filter — bets in other states may still be here."
        />
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {result.items.map((b) => {
            const r = RESULT_STYLE[b.result];
            return (
              <li
                key={b.id}
                style={{
                  border: '1px solid #e5e7eb',
                  borderRadius: 10,
                  padding: '0.75rem 1rem',
                  marginBottom: '0.6rem',
                  background: '#fff',
                }}
              >
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}
                >
                  <Link
                    href={b.sharePath}
                    style={{ fontWeight: 600, color: '#1f2937', textDecoration: 'none' }}
                  >
                    {b.title}
                  </Link>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <StatusBadge status={b.status} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: r.color }}>{r.label}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 6, fontSize: 13, opacity: 0.8 }}>
                  <span>
                    Side <code>{b.userSide}</code> ({b.role})
                  </span>
                  <span>Stake {formatUsdc(b.userStakeUsdc)}</span>
                  <span>Pot {formatUsdc(b.potUsdc)}</span>
                  <span>{humanizeResolveType(b.resolveType)}</span>
                  <span>{formatDateTime(b.createdAt)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Pagination */}
      {result.total > result.pageSize ? (
        <div style={{ display: 'flex', gap: 16, marginTop: '1rem', fontSize: 14 }}>
          {params.page > 1 ? (
            <Link href={buildProfileHref(basePath, params, { page: params.page - 1 })}>← Prev</Link>
          ) : (
            <span style={{ opacity: 0.4 }}>← Prev</span>
          )}
          <span style={{ opacity: 0.6 }}>
            Page {result.page} of {Math.max(1, Math.ceil(result.total / result.pageSize))}
          </span>
          {result.hasMore ? (
            <Link href={buildProfileHref(basePath, params, { page: params.page + 1 })}>Next →</Link>
          ) : (
            <span style={{ opacity: 0.4 }}>Next →</span>
          )}
        </div>
      ) : null}
    </section>
  );
}
