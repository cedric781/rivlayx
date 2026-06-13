import { formatUsdc } from './format';

export interface BalanceCardProps {
  availableUsdc: string;
  lockedUsdc: string;
}

export function BalanceCard({ availableUsdc, lockedUsdc }: BalanceCardProps) {
  return (
    <section
      style={{
        background: '#13161a',
        border: '1px solid #2c3036',
        borderRadius: 12,
        padding: '1.5rem',
      }}
    >
      <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.6 }}>
        Available balance
      </div>
      <div style={{ fontSize: 36, fontWeight: 700, marginTop: '0.25rem' }}>
        {formatUsdc(availableUsdc)} <span style={{ fontSize: 18, opacity: 0.7 }}>USDC</span>
      </div>
      <div style={{ marginTop: '0.75rem', fontSize: 14, opacity: 0.65 }}>
        Locked in active bets: {formatUsdc(lockedUsdc)} USDC
      </div>
    </section>
  );
}
