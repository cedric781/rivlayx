import type { CSSProperties, ReactNode } from 'react';

/**
 * Shared page shell. Presentational only — gives every page a consistent
 * max-width, fluid gutters, and device safe-area padding so layouts stay
 * centered and never cause horizontal scroll on mobile. Renders the page <main>.
 */
const MAX_WIDTH: Record<'sm' | 'md' | 'lg' | 'xl', number> = {
  sm: 640,
  md: 768,
  lg: 960,
  xl: 1100,
};

export interface PageContainerProps {
  children: ReactNode;
  size?: keyof typeof MAX_WIDTH;
  style?: CSSProperties;
}

export function PageContainer({ children, size = 'lg', style }: PageContainerProps) {
  return (
    <main
      style={{
        width: '100%',
        maxWidth: MAX_WIDTH[size],
        marginInline: 'auto',
        // Fluid gutters that also clear notches/safe areas on mobile.
        paddingInline:
          'max(clamp(var(--rx-space-4), 4vw, var(--rx-space-6)), env(safe-area-inset-left), env(safe-area-inset-right))',
        paddingBlock: 'clamp(var(--rx-space-5), 4vw, var(--rx-space-8))',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {children}
    </main>
  );
}
