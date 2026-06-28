import type { CSSProperties, ReactNode } from 'react';

/**
 * Shared stat tile (dark shell). Presentational only — a token-driven panel with
 * an uppercase label, a prominent value, and an optional supporting hint. Used
 * for at-a-glance summaries (dashboard, wallet). Style is merge-overridable.
 */
export interface StatProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  /** Optional leading glyph rendered next to the label. */
  icon?: ReactNode;
  /** Override the value color (e.g. a semantic token for win/loss). */
  accent?: string;
  style?: CSSProperties;
}

export function Stat({ label, value, hint, icon, accent, style }: StatProps) {
  return (
    <div
      style={{
        background: 'var(--rx-color-surface)',
        border: '1px solid var(--rx-color-border)',
        borderRadius: 'var(--rx-radius-xl)',
        padding: 'var(--rx-space-4)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--rx-space-1)',
        minWidth: 0,
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--rx-space-2)' }}>
        {icon ? (
          <span aria-hidden="true" style={{ display: 'inline-flex', color: 'var(--rx-color-text-faint)' }}>
            {icon}
          </span>
        ) : null}
        <span
          style={{
            fontSize: 'var(--rx-font-size-xs)',
            textTransform: 'uppercase',
            letterSpacing: 'var(--rx-letter-spacing-wide)',
            fontWeight: 'var(--rx-font-weight-semibold)',
            color: 'var(--rx-color-text-muted)',
          }}
        >
          {label}
        </span>
      </div>
      <div
        style={{
          fontSize: 'var(--rx-font-size-2xl)',
          fontWeight: 'var(--rx-font-weight-bold)',
          lineHeight: 'var(--rx-line-tight)',
          color: accent ?? 'var(--rx-color-text)',
          overflowWrap: 'anywhere',
        }}
      >
        {value}
      </div>
      {hint ? (
        <div style={{ fontSize: 'var(--rx-font-size-xs)', color: 'var(--rx-color-text-faint)' }}>{hint}</div>
      ) : null}
    </div>
  );
}
