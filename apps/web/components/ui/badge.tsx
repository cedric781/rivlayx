import type { CSSProperties, ReactNode } from 'react';

/**
 * Shared badge/chip primitive. Presentational only — `tone` maps to the
 * paper-context semantic tint tokens so badges stay consistent across the app.
 */
export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

const TONE: Record<BadgeTone, { bg: string; fg: string }> = {
  neutral: { bg: 'var(--rx-color-neutral-bg)', fg: 'var(--rx-color-neutral-fg)' },
  success: { bg: 'var(--rx-color-success-bg)', fg: 'var(--rx-color-success)' },
  warning: { bg: 'var(--rx-color-warning-bg)', fg: 'var(--rx-color-warning)' },
  danger: { bg: 'var(--rx-color-danger-bg)', fg: 'var(--rx-color-danger)' },
  info: { bg: 'var(--rx-color-info-bg)', fg: 'var(--rx-color-info-strong)' },
  accent: { bg: 'var(--rx-color-accent-bg)', fg: 'var(--rx-color-accent)' },
};

export interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  size?: 'sm' | 'md';
  uppercase?: boolean;
  title?: string;
  style?: CSSProperties;
}

export function Badge({
  children,
  tone = 'neutral',
  size = 'md',
  uppercase = false,
  title,
  style,
}: BadgeProps) {
  const { bg, fg } = TONE[tone];
  return (
    <span
      title={title}
      style={{
        display: 'inline-block',
        background: bg,
        color: fg,
        fontSize: 'var(--rx-font-size-xs)',
        fontWeight: 700,
        padding: size === 'sm' ? '1px 6px' : '2px 8px',
        borderRadius: 'var(--rx-radius-pill)',
        letterSpacing: 'var(--rx-letter-spacing-wide)',
        textTransform: uppercase ? 'uppercase' : 'none',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </span>
  );
}
