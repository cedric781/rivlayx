import type { CSSProperties, ReactNode } from 'react';

/**
 * Shared paper card primitive. Presentational only — token-driven surface,
 * border, radius and padding. Pass `interactive` for hover affordance (used
 * when the card is wrapped in a link). Style is merge-overridable.
 */
export interface CardProps {
  children: ReactNode;
  interactive?: boolean;
  style?: CSSProperties;
}

const base: CSSProperties = {
  background: 'var(--rx-color-paper)',
  border: '1px solid var(--rx-color-paper-border-muted)',
  borderRadius: 'var(--rx-radius-xl)',
  padding: 'var(--rx-space-4)',
  color: 'var(--rx-color-paper-ink)',
};

export function Card({ children, interactive = false, style }: CardProps) {
  return (
    <div className={interactive ? 'rx-card--interactive' : undefined} style={{ ...base, ...style }}>
      {children}
    </div>
  );
}
