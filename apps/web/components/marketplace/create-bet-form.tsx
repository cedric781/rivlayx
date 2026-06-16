'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { formatUsdc } from '@/lib/marketplace/format';
import { createBetErrorMessage } from '@/lib/bets/open-bet';
import { CopyButton } from '@/components/wallet/copy-button';

export interface CreateBetFormProps {
  /** Creator's available balance, decimal string. */
  availableUsdc: string;
  /** Per-bet stake cap (mirrors MAX_BET_USDC). */
  maxStakeUsdc: string;
  /** Anti-spam creation fee, charged on top of the stake. */
  creationFeeUsdc: string;
}

interface CreatedBet {
  id: string;
  shareSlug: string;
}

const EXPIRY_PRESETS: { key: string; label: string; ms: number }[] = [
  { key: '1h', label: '1 hour', ms: 60 * 60_000 },
  { key: '24h', label: '24 hours', ms: 24 * 60 * 60_000 },
  { key: '3d', label: '3 days', ms: 3 * 24 * 60 * 60_000 },
];

const label: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.6,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  display: 'block',
  marginBottom: 6,
};
const input: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.65rem',
  borderRadius: 8,
  border: '1px solid #cbd5e1',
  fontSize: 14,
  boxSizing: 'border-box',
};
const field: React.CSSProperties = { marginBottom: '1.1rem' };

/** Format a Date as a `datetime-local` value (local time, minute precision). */
function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function CreateBetForm({ availableUsdc, maxStakeUsdc, creationFeeUsdc }: CreateBetFormProps) {
  const defaultResolveBy = useMemo(() => toLocalInputValue(new Date(Date.now() + 4 * 86_400_000)), []);

  const [title, setTitle] = useState('');
  const [stake, setStake] = useState('5');
  const [creatorSide, setCreatorSide] = useState('yes');
  const [expiryPreset, setExpiryPreset] = useState('24h');
  const [resolvesByLocal, setResolvesByLocal] = useState(defaultResolveBy);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedBet | null>(null);

  const stakeNum = Number(stake);
  const totalCost = Number.isFinite(stakeNum) ? stakeNum + Number(creationFeeUsdc) : NaN;
  const hasFunds = Number.isFinite(totalCost) && Number(availableUsdc) >= totalCost;
  const stakeValid = Number.isFinite(stakeNum) && stakeNum > 0 && stakeNum <= Number(maxStakeUsdc);
  const titleValid = title.trim().length >= 1 && title.trim().length <= 280;
  const sideValid = creatorSide.trim().length >= 1 && creatorSide.trim().length <= 64;

  const preset = EXPIRY_PRESETS.find((p) => p.key === expiryPreset) ?? EXPIRY_PRESETS[1]!;

  async function onCreate() {
    setError(null);
    if (!titleValid) return setError('Give your bet a title (1–280 characters).');
    if (!stakeValid) return setError(`Stake must be between 0 and ${formatUsdc(maxStakeUsdc)}.`);
    if (!sideValid) return setError('Enter your side (1–64 characters).');
    if (!hasFunds) {
      return setError(
        `You need ${formatUsdc(totalCost)} (stake + ${formatUsdc(creationFeeUsdc)} fee) but have ${formatUsdc(availableUsdc)}.`,
      );
    }

    const expiresAt = new Date(Date.now() + preset.ms).toISOString();
    const resolvesByDate = new Date(resolvesByLocal);
    if (Number.isNaN(resolvesByDate.getTime())) return setError('Choose a valid resolve date.');
    if (resolvesByDate.getTime() <= Date.now() + preset.ms) {
      return setError('The resolve date must be after the bet closes for acceptance.');
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/bets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          stakeUsdc: stake.trim(),
          creatorSide: creatorSide.trim(),
          expiresAt,
          resolvesBy: resolvesByDate.toISOString(),
        }),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const code = (data as { error?: { code?: string } } | null)?.error?.code ?? '';
        const message = (data as { error?: { message?: string } } | null)?.error?.message;
        setError(createBetErrorMessage(code, message));
        return;
      }
      const ok = data as { bet?: { id?: string }; shareSlug?: string } | null;
      if (ok?.bet?.id && ok.shareSlug) {
        setCreated({ id: ok.bet.id, shareSlug: ok.shareSlug });
      } else {
        setError('Bet created, but the response was unexpected. Check your bets list.');
      }
    } catch {
      setError('Network error — please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    const shareUrl =
      typeof window !== 'undefined' ? `${window.location.origin}/b/${created.shareSlug}` : `/b/${created.shareSlug}`;
    return (
      <div
        style={{
          border: '1px solid #bbf7d0',
          background: '#f0fdf4',
          borderRadius: 12,
          padding: '1.25rem',
          marginTop: '1.5rem',
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Bet created 🎉</h2>
        <p style={{ marginTop: 0, fontSize: 14, opacity: 0.75 }}>
          Share this link — anyone signed in can take the open side.
        </p>

        <div style={{ ...label }}>Share link</div>
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            flexWrap: 'wrap',
            marginBottom: '1.1rem',
          }}
        >
          <code style={{ wordBreak: 'break-all', fontSize: 13 }}>{shareUrl}</code>
          <CopyButton text={shareUrl} label="Copy link" />
        </div>

        <Link
          href={`/b/${created.shareSlug}`}
          style={{
            display: 'inline-block',
            padding: '0.55rem 1.3rem',
            borderRadius: 8,
            background: '#1f2937',
            color: '#fff',
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          Open bet →
        </Link>
      </div>
    );
  }

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <div style={field}>
        <label htmlFor="bet-title" style={label}>
          Title (objective, measurable)
        </label>
        <input
          id="bet-title"
          type="text"
          value={title}
          maxLength={280}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. The Amsterdam Marathon winner finishes under 2h10m"
          style={input}
        />
        <p style={{ margin: '6px 0 0', fontSize: 12, opacity: 0.55 }}>
          Avoid subjective wording (“best”, “nicest”). State something that can be objectively judged.
        </p>
      </div>

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ ...field, flex: '1 1 160px' }}>
          <label htmlFor="bet-stake" style={label}>
            Your stake (USDC)
          </label>
          <input
            id="bet-stake"
            type="number"
            min="0"
            max={maxStakeUsdc}
            step="0.01"
            value={stake}
            onChange={(e) => setStake(e.target.value)}
            style={input}
          />
          <p style={{ margin: '6px 0 0', fontSize: 12, opacity: 0.55 }}>
            Max {formatUsdc(maxStakeUsdc)} · + {formatUsdc(creationFeeUsdc)} fee · you have{' '}
            <strong style={{ color: hasFunds ? undefined : '#b91c1c' }}>{formatUsdc(availableUsdc)}</strong>
          </p>
        </div>

        <div style={{ ...field, flex: '1 1 160px' }}>
          <label htmlFor="bet-side" style={label}>
            Your side
          </label>
          <input
            id="bet-side"
            type="text"
            value={creatorSide}
            maxLength={64}
            onChange={(e) => setCreatorSide(e.target.value)}
            placeholder="e.g. yes"
            style={input}
          />
          <p style={{ margin: '6px 0 0', fontSize: 12, opacity: 0.55 }}>
            The acceptor takes the opposing side.
          </p>
        </div>
      </div>

      <div style={field}>
        <span style={label}>Open for acceptance</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {EXPIRY_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setExpiryPreset(p.key)}
              style={{
                padding: '0.4rem 0.9rem',
                borderRadius: 8,
                border: expiryPreset === p.key ? '2px solid #4458c7' : '1px solid #cbd5e1',
                background: expiryPreset === p.key ? '#eef2ff' : '#fff',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div style={field}>
        <label htmlFor="bet-resolveby" style={label}>
          Judged after (resolve date)
        </label>
        <input
          id="bet-resolveby"
          type="datetime-local"
          value={resolvesByLocal}
          onChange={(e) => setResolvesByLocal(e.target.value)}
          style={{ ...input, maxWidth: 280 }}
        />
        <p style={{ margin: '6px 0 0', fontSize: 12, opacity: 0.55 }}>
          A platform arbiter judges this bet after this date.
        </p>
      </div>

      {error ? (
        <p
          role="alert"
          style={{
            margin: '0 0 0.9rem',
            padding: '0.55rem 0.8rem',
            borderRadius: 8,
            background: '#fee2e2',
            color: '#b91c1c',
            fontSize: 13,
          }}
        >
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={onCreate}
        disabled={submitting}
        style={{
          padding: '0.65rem 1.5rem',
          borderRadius: 8,
          border: 'none',
          background: submitting ? '#9ca3af' : '#1f2937',
          color: '#fff',
          fontWeight: 600,
          cursor: submitting ? 'not-allowed' : 'pointer',
        }}
      >
        {submitting ? 'Creating…' : 'Create bet'}
      </button>
    </div>
  );
}
