import type { CSSProperties, ReactNode } from 'react';

/**
 * Horizontal-scroll wrapper for wide tables. Presentational only — keeps wide
 * tables readable on narrow screens by scrolling them instead of letting them
 * overflow the page or crush their columns. Pair with a `minWidth` on the table.
 */
export function TableScroll({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        width: '100%',
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        ...style,
      }}
    >
      {children}
    </div>
  );
}
