'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
      <Input
        label="Share URL"
        hideLabel
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        fullWidth={false}
        containerStyle={{ flex: '1 1 240px' }}
        style={{
          padding: '0.45rem 0.6rem',
          borderColor: 'var(--rx-color-paper-border-strong)',
          fontSize: 'var(--rx-font-size-sm)',
        }}
      />
      <Button type="button" variant="primary" size="sm" onClick={copy}>
        {copied ? 'Copied!' : 'Copy link'}
      </Button>
    </div>
  );
}
