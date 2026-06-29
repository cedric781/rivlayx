import type { CSSProperties } from 'react';

/**
 * Shared loading skeleton primitive. Presentational only — a token-driven
 * placeholder block with a gentle pulse (disabled under reduced-motion via the
 * `.rx-skeleton` class in globals.css). Size it with width/height/style.
 */
export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: string;
  style?: CSSProperties;
}

export function Skeleton({
  width = '100%',
  height = '1rem',
  radius = 'var(--rx-radius-md)',
  style,
}: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className="rx-skeleton"
      style={{
        display: 'block',
        width,
        height,
        borderRadius: radius,
        background: 'var(--rx-color-surface-2)',
        ...style,
      }}
    />
  );
}
