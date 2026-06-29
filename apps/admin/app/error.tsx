'use client';

import Link from 'next/link';
import { useEffect } from 'react';

const wrap: React.CSSProperties = {
  maxWidth: 560,
  margin: '6rem auto',
  padding: '0 1.5rem',
  textAlign: 'center',
};
const eyebrow: React.CSSProperties = {
  fontSize: 'var(--rx-font-size-xs)',
  textTransform: 'uppercase',
  letterSpacing: 'var(--rx-letter-spacing-wide)',
  color: 'var(--rx-color-text-muted)',
  margin: 0,
};
const primaryAction: React.CSSProperties = {
  padding: '0.6rem 1.4rem',
  borderRadius: 'var(--rx-radius-lg)',
  background: 'var(--rx-color-primary)',
  color: 'var(--rx-color-primary-contrast)',
  border: 'none',
  fontWeight: 600,
  fontSize: 'var(--rx-font-size-base)',
  cursor: 'pointer',
};
const secondaryAction: React.CSSProperties = {
  color: 'var(--rx-color-primary)',
  textDecoration: 'none',
  fontWeight: 600,
  fontSize: 'var(--rx-font-size-base)',
};

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main style={wrap}>
      <p style={eyebrow}>RivlayX Admin</p>
      <h1 style={{ fontSize: 'var(--rx-font-size-2xl)', margin: '0.5rem 0 0' }}>
        Something went wrong
      </h1>
      <p style={{ color: 'var(--rx-color-text-muted)', marginTop: '0.75rem' }}>
        An unexpected error occurred. You can try again, or return to the dashboard.
      </p>
      <div
        style={{
          marginTop: 'var(--rx-space-5)',
          display: 'flex',
          gap: 'var(--rx-space-5)',
          justifyContent: 'center',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <button type="button" onClick={reset} style={primaryAction}>
          Try again
        </button>
        <Link href="/dashboard" style={secondaryAction}>
          Back to dashboard →
        </Link>
      </div>
      {error.digest && (
        <p style={{ marginTop: 'var(--rx-space-5)', fontSize: 'var(--rx-font-size-xs)', color: 'var(--rx-color-text-faint)' }}>
          Reference: {error.digest}
        </p>
      )}
    </main>
  );
}
