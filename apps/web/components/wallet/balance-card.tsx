import { formatUsdc } from './format';

export interface BalanceCardProps {
  availableUsdc: string;
  lockedUsdc: string;
}

/**
 * Premium available-balance hero (dark shell). Presentational only — token-driven
 * surface with a subtle accent glow, an oversized available figure, and a clearly
 * subordinate "locked" line so the spendable amount reads first.
 */
export function BalanceCard({ availableUsdc, lockedUsdc }: BalanceCardProps) {
  return (
    <section
      style={{
        position: 'relative',
        overflow: 'hidden',
        background:
          'linear-gradient(135deg, var(--rx-color-surface) 0%, var(--rx-color-surface-2) 100%)',
        border: '1px solid var(--rx-color-border)',
        borderRadius: 'var(--rx-radius-xl)',
        padding: 'var(--rx-space-6)',
        boxShadow: 'var(--rx-shadow-md)',
      }}
    >
      {/* Soft brand glow in the corner — purely decorative. */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: -70,
          right: -50,
          width: 220,
          height: 220,
          background: 'radial-gradient(closest-side, rgba(91, 141, 239, 0.18), transparent)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          fontSize: 'var(--rx-font-size-xs)',
          textTransform: 'uppercase',
          letterSpacing: 'var(--rx-letter-spacing-wide)',
          fontWeight: 'var(--rx-font-weight-semibold)',
          color: 'var(--rx-color-text-muted)',
        }}
      >
        Available balance
      </div>
      <div
        style={{
          marginTop: 'var(--rx-space-2)',
          fontSize: 'clamp(2.25rem, 7vw, 3rem)',
          fontWeight: 'var(--rx-font-weight-bold)',
          lineHeight: 'var(--rx-line-tight)',
          letterSpacing: '-0.5px',
          color: 'var(--rx-color-text)',
        }}
      >
        {formatUsdc(availableUsdc)}
      </div>
      <div
        style={{
          marginTop: 'var(--rx-space-4)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--rx-space-2)',
          fontSize: 'var(--rx-font-size-sm)',
          color: 'var(--rx-color-text-muted)',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            borderRadius: 'var(--rx-radius-pill)',
            background: 'var(--rx-color-warning-fg)',
            flexShrink: 0,
          }}
        />
        Locked in active bets:{' '}
        <strong style={{ color: 'var(--rx-color-text)', fontWeight: 'var(--rx-font-weight-semibold)' }}>
          {formatUsdc(lockedUsdc)}
        </strong>
      </div>
    </section>
  );
}
