'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export interface ActionButtonProps {
  endpoint: string;
  label: string;
  /** When true, also collects a `reason` from the user via prompt before posting. */
  requireReason?: boolean;
  /** Extra fields appended to the JSON body. */
  body?: Record<string, unknown>;
  tone?: 'default' | 'danger';
  confirmMessage?: string;
}

export function ActionButton({
  endpoint,
  label,
  requireReason = false,
  body = {},
  tone = 'default',
  confirmMessage,
}: ActionButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    let reason: string | undefined;
    if (requireReason) {
      const input = window.prompt(`Reason for "${label}":`);
      if (!input) return;
      reason = input;
    }
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, ...(reason ? { reason } : {}) }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: { message?: string; code?: string };
        } | null;
        throw new Error(data?.error?.message ?? `Request failed (${res.status})`);
      }
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const bg = tone === 'danger' ? 'var(--rx-color-danger-button)' : 'var(--rx-color-primary)';
  return (
    <form onSubmit={onSubmit} style={{ display: 'inline-block', marginRight: 8 }}>
      <button
        type="submit"
        disabled={busy}
        style={{
          padding: '0.4rem 0.9rem',
          background: busy ? 'var(--rx-color-disabled-bg-dark)' : bg,
          color: 'var(--rx-color-primary-contrast)',
          border: 'none',
          borderRadius: 4,
          cursor: busy ? 'not-allowed' : 'pointer',
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        {busy ? 'Working…' : label}
      </button>
      {error && (
        <p role="alert" style={{ color: 'var(--rx-color-danger-fg)', margin: '0.25rem 0 0', fontSize: 12 }}>
          {error}
        </p>
      )}
    </form>
  );
}
