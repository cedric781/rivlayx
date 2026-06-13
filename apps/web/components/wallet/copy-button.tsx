'use client';
import { useState } from 'react';

const baseStyle = {
  padding: '4px 10px',
  background: 'transparent',
  color: '#5b8def',
  border: '1px solid #2c3036',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 12,
};

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function onClick() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API not available — fall through
    }
  }

  return (
    <button onClick={onClick} style={baseStyle}>
      {copied ? 'Copied ✓' : label}
    </button>
  );
}
