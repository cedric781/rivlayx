import type { reputation } from '@rivlayx/core';

/**
 * Public reputation badge. Shows the **tier only** — the numeric score is never
 * exposed in the UI. Provisional accounts (and the `new` tier) render as "New".
 *
 * `NEXT_PUBLIC_REPUTATION_BADGES=off` hides all badges (rollout kill-switch).
 */
const TIER_STYLE: Record<reputation.ReputationTier, { label: string; bg: string; fg: string }> = {
  new: { label: 'New', bg: '#f1f5f9', fg: '#64748b' },
  untrusted: { label: 'Untrusted', bg: '#fee2e2', fg: '#b91c1c' },
  bronze: { label: 'Bronze', bg: '#f5e9da', fg: '#92611f' },
  silver: { label: 'Silver', bg: '#eef2f6', fg: '#52708a' },
  gold: { label: 'Gold', bg: '#fdf6d8', fg: '#a16207' },
  trusted: { label: 'Trusted', bg: '#dcfce7', fg: '#15803d' },
};

export function ReputationBadge({
  tier,
  provisional,
  size = 'md',
}: {
  tier: reputation.ReputationTier;
  provisional: boolean;
  size?: 'sm' | 'md';
}) {
  if (process.env['NEXT_PUBLIC_REPUTATION_BADGES'] === 'off') return null;

  const effective = provisional ? 'new' : tier;
  const style = TIER_STYLE[effective] ?? TIER_STYLE.new;
  const fontSize = size === 'sm' ? 10 : 11;
  return (
    <span
      title={`Reputation: ${style.label}`}
      style={{
        fontSize,
        fontWeight: 700,
        padding: size === 'sm' ? '1px 6px' : '2px 8px',
        borderRadius: 999,
        background: style.bg,
        color: style.fg,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
        whiteSpace: 'nowrap',
      }}
    >
      {style.label}
    </span>
  );
}
