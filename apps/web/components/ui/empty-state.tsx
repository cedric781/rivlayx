import type { ReactNode } from 'react';

/**
 * Shared empty-state primitive. Presentational only — centered title, optional
 * hint, and an optional action (e.g. a CTA link/button). Token-driven spacing
 * and colors so empty views read consistently across the app.
 */
export interface EmptyStateProps {
  title: string;
  hint?: string;
  /** Optional CTA or other action rendered below the hint. */
  action?: ReactNode;
}

export function EmptyState({ title, hint, action }: EmptyStateProps) {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: 'var(--rx-space-6) var(--rx-space-4)',
        color: 'var(--rx-color-text-muted)',
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: 'var(--rx-font-size-md)',
          fontWeight: 600,
          color: 'var(--rx-color-text)',
        }}
      >
        {title}
      </p>
      {hint ? (
        <p
          style={{
            margin: 'var(--rx-space-2) auto 0',
            maxWidth: 420,
            fontSize: 'var(--rx-font-size-base)',
            lineHeight: 'var(--rx-line-normal)',
          }}
        >
          {hint}
        </p>
      ) : null}
      {action ? <div style={{ marginTop: 'var(--rx-space-4)' }}>{action}</div> : null}
    </div>
  );
}
