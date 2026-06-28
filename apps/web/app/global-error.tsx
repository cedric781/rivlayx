'use client';

import { useEffect } from 'react';

/**
 * Last-resort error boundary: catches errors thrown by the root layout itself,
 * which a route-level error.tsx cannot. It replaces the whole document, so it
 * renders its own <html>/<body> and uses self-contained literal colors (the app
 * theme/tokens may not be applied at this point). No stack trace is shown.
 */
export default function GlobalError({
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
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0b0d10',
          color: '#e6e8eb',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <main style={{ maxWidth: 480, padding: '0 1.5rem', textAlign: 'center' }}>
          <p
            style={{
              margin: 0,
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '0.4px',
              color: '#9fa6ad',
            }}
          >
            RivlayX
          </p>
          <h1 style={{ fontSize: 24, margin: '0.5rem 0 0' }}>Something went wrong</h1>
          <p style={{ color: '#9fa6ad', marginTop: '0.75rem', lineHeight: 1.5 }}>
            An unexpected error occurred. Please try again — if it keeps happening, come back in a
            little while.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: '1.5rem',
              padding: '0.6rem 1.4rem',
              borderRadius: 8,
              background: '#5b8def',
              color: '#ffffff',
              border: 'none',
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
          {error.digest ? (
            <p style={{ marginTop: '1.5rem', fontSize: 11, color: '#6b7280' }}>
              Reference: {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
