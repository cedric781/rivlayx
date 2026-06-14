import type { profiles } from '@rivlayx/core';
import { formatUsdc } from '@/lib/marketplace/format';

const card: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  padding: '0.9rem 1rem',
  background: '#fff',
};
const label: React.CSSProperties = {
  fontSize: 11,
  opacity: 0.55,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
};
const value: React.CSSProperties = { fontSize: 20, fontWeight: 700, marginTop: 2 };

function Stat({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={card}>
      <div style={label}>{title}</div>
      <div style={value}>{children}</div>
    </div>
  );
}

export function ProfileStats({ stats }: { stats: profiles.ProfileStats }) {
  const winRatePct = `${(stats.winRate * 100).toFixed(1)}%`;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: '0.75rem',
        marginBottom: '1.5rem',
      }}
    >
      <Stat title="Total Bets">{stats.totalBets}</Stat>
      <Stat title="Wins">{stats.wins}</Stat>
      <Stat title="Losses">{stats.losses}</Stat>
      <Stat title="Win Rate">{winRatePct}</Stat>
      <Stat title="Total Volume">{formatUsdc(stats.totalVolumeUsdc)}</Stat>
      <Stat title="Total Winnings">{formatUsdc(stats.totalWinningsUsdc)}</Stat>
      <Stat title="Total Losses">{formatUsdc(stats.totalLossesUsdc)}</Stat>
      <Stat title="Active Bets">{stats.activeBets}</Stat>
      <Stat title="Open Bets">{stats.openBets}</Stat>
    </div>
  );
}
