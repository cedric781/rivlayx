'use client';

import { useEffect, useState } from 'react';

/** Copyable share URL built from the bet's preferred share path (`/b/<code>`). */
export function ShareLink({ sharePath }: { sharePath: string }) {
  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const url = `${origin}${sharePath}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — the input remains selectable as a fallback
    }
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <input
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        style={{
          flex: '1 1 240px',
          padding: '0.45rem 0.6rem',
          borderRadius: 8,
          border: '1px solid #d1d5db',
          fontSize: 13,
          background: '#fff',
        }}
        aria-label="Share URL"
      />
      <button
        type="button"
        onClick={copy}
        style={{
          padding: '0.45rem 0.9rem',
          borderRadius: 8,
          border: '1px solid #1f2937',
          background: '#1f2937',
          color: '#fff',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        {copied ? 'Copied!' : 'Copy link'}
      </button>
    </div>
  );
}
