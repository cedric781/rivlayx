'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatUsdc } from '@/lib/marketplace/format';

export interface AcceptBetCardProps {
  /** Canonical bet id (UUID) — used for the POST URL. */
  betId: string;
  stakeRequiredUsdc: string;
  potUsdc: string;
  creatorSide: string;
  /** Acceptor's currently-available balance, decimal string. */
  availableUsdc: string;
  /** Template side labels, or null for free-form bets. */
  templateSides: string[] | null;
}

type SideMode =
  | { kind: 'fixed'; side: string }
  | { kind: 'select'; options: string[] }
  | { kind: 'freeform' };

function deriveSideMode(templateSides: string[] | null, creatorSide: string): SideMode {
  if (!templateSides) return { kind: 'freeform' };
  const options = templateSides.filter((s) => s !== creatorSide);
  if (options.length === 1) return { kind: 'fixed', side: options[0]! };
  if (options.length > 1) return { kind: 'select', options };
  // Degenerate template (no opposing side) — fall back to free-form entry.
  return { kind: 'freeform' };
}

const card: React.CSSProperties = {
  border: '1px solid #c7d2fe',
  borderRadius: 12,
  padding: '1.1rem 1.25rem',
  background: '#f5f7ff',
  marginBottom: '1rem',
};
const label: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.55,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
};

export function AcceptBetCard({
  betId,
  stakeRequiredUsdc,
  potUsdc,
  creatorSide,
  availableUsdc,
  templateSides,
}: AcceptBetCardProps) {
  const router = useRouter();
  const mode = useMemo(() => deriveSideMode(templateSides, creatorSide), [templateSides, creatorSide]);

  const [selectedSide, setSelectedSide] = useState<string>(
    mode.kind === 'fixed' ? mode.side : mode.kind === 'select' ? '' : '',
  );
  const [freeformSide, setFreeformSide] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** form → confirm (review the lock) → success (stake locked, bet ACTIVE). */
  const [step, setStep] = useState<'form' | 'confirm' | 'success'>('form');
  const [accepted, setAccepted] = useState<{ side: string; stakeLockedUsdc: string; status: string } | null>(null);

  const yourSide = mode.kind === 'fixed' ? mode.side : mode.kind === 'freeform' ? freeformSide.trim() : selectedSide;

  const hasFunds = Number(availableUsdc) >= Number(stakeRequiredUsdc);
  const sideChosen = yourSide.length >= 1 && yourSide.length <= 64 && yourSide !== creatorSide;
  const canSubmit = hasFunds && sideChosen && !submitting;

  /** Validate the form, then move to the confirmation step (no money moves yet). */
  function onReview() {
    setError(null);
    if (!hasFunds) {
      setError('Insufficient balance — deposit more USDC to accept this bet.');
      return;
    }
    if (!sideChosen) {
      setError(`Choose a side different from the creator's ("${creatorSide}").`);
      return;
    }
    setStep('confirm');
  }

  /** Commit the accept: lock stake into escrow and flip OPEN → ACTIVE via the engine. */
  async function onConfirm() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/bets/${betId}/accept`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ acceptorSide: yourSide }),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const message =
          (data as { error?: { message?: string } } | null)?.error?.message ??
          `Accept failed (${res.status})`;
        setError(message);
        setStep('form');
        return;
      }
      const ok = data as
        | { bet?: { status?: string }; acceptorParticipant?: { side?: string; stakeLockedUsdc?: string } }
        | null;
      setAccepted({
        side: ok?.acceptorParticipant?.side ?? yourSide,
        stakeLockedUsdc: ok?.acceptorParticipant?.stakeLockedUsdc ?? stakeRequiredUsdc,
        status: ok?.bet?.status ?? 'ACTIVE',
      });
      setStep('success');
    } catch {
      setError('Network error — please try again.');
      setStep('form');
    } finally {
      setSubmitting(false);
    }
  }

  if (step === 'success' && accepted) {
    return (
      <div
        style={{
          border: '1px solid #bbf7d0',
          background: '#f0fdf4',
          borderRadius: 12,
          padding: '1.25rem',
          marginBottom: '1rem',
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Bet accepted 🎉</h2>
        <p style={{ marginTop: 0, fontSize: 14, opacity: 0.8 }}>
          You locked <strong>{formatUsdc(accepted.stakeLockedUsdc)}</strong> on side{' '}
          <code>{accepted.side}</code>. The bet is now <strong>{accepted.status}</strong> and the{' '}
          {formatUsdc(potUsdc)} pot is in escrow until it resolves.
        </p>
        <button
          type="button"
          onClick={() => router.refresh()}
          style={{
            padding: '0.55rem 1.3rem',
            borderRadius: 8,
            border: 'none',
            background: '#1f2937',
            color: '#fff',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          View active bet →
        </button>
      </div>
    );
  }

  return (
    <div style={card}>
      <h2 style={{ fontSize: 16, marginTop: 0 }}>
        {step === 'confirm' ? 'Confirm acceptance' : 'Accept this bet'}
      </h2>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: '0.9rem',
          marginBottom: '1rem',
        }}
      >
        <div>
          <div style={label}>Your available balance</div>
          <div style={{ fontWeight: 600, color: hasFunds ? undefined : '#b91c1c' }}>
            {formatUsdc(availableUsdc)}
          </div>
        </div>
        <div>
          <div style={label}>Stake required</div>
          <div style={{ fontWeight: 600 }}>{formatUsdc(stakeRequiredUsdc)}</div>
        </div>
        <div>
          <div style={label}>Pot size</div>
          <div style={{ fontWeight: 700 }}>{formatUsdc(potUsdc)}</div>
        </div>
        <div>
          <div style={label}>Creator side</div>
          <div style={{ fontWeight: 600 }}>
            <code>{creatorSide}</code>
          </div>
        </div>
        <div>
          <div style={label}>Your side</div>
          <div style={{ fontWeight: 600 }}>{yourSide ? <code>{yourSide}</code> : '—'}</div>
        </div>
      </div>

      {step === 'form' && mode.kind === 'select' ? (
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ ...label, marginBottom: 6 }}>Choose your side</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {mode.options.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setSelectedSide(opt)}
                style={{
                  padding: '0.4rem 0.9rem',
                  borderRadius: 8,
                  border: selectedSide === opt ? '2px solid #4458c7' : '1px solid #cbd5e1',
                  background: selectedSide === opt ? '#eef2ff' : '#fff',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {step === 'form' && mode.kind === 'freeform' ? (
        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="acceptor-side" style={{ ...label, display: 'block', marginBottom: 6 }}>
            Your side (must differ from “{creatorSide}”)
          </label>
          <input
            id="acceptor-side"
            type="text"
            value={freeformSide}
            maxLength={64}
            onChange={(e) => setFreeformSide(e.target.value)}
            placeholder="e.g. no"
            style={{
              width: '100%',
              maxWidth: 280,
              padding: '0.45rem 0.6rem',
              borderRadius: 8,
              border: '1px solid #cbd5e1',
              fontSize: 14,
            }}
          />
        </div>
      ) : null}

      {error ? (
        <p
          role="alert"
          style={{
            margin: '0 0 0.75rem',
            padding: '0.5rem 0.75rem',
            borderRadius: 8,
            background: '#fee2e2',
            color: '#b91c1c',
            fontSize: 13,
          }}
        >
          {error}
        </p>
      ) : null}

      {!hasFunds ? (
        <p style={{ margin: '0 0 0.75rem', fontSize: 13, color: '#b91c1c' }}>
          You need {formatUsdc(stakeRequiredUsdc)} but only have {formatUsdc(availableUsdc)}.
        </p>
      ) : null}

      {step === 'confirm' ? (
        <>
          <p style={{ margin: '0 0 0.9rem', fontSize: 14 }}>
            You are about to lock <strong>{formatUsdc(stakeRequiredUsdc)}</strong> on side{' '}
            <code>{yourSide}</code>. This funds escrow and makes the bet <strong>ACTIVE</strong> — it
            cannot be undone.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={onConfirm}
              disabled={submitting}
              style={{
                padding: '0.6rem 1.4rem',
                borderRadius: 8,
                border: 'none',
                background: submitting ? '#9ca3af' : '#1f2937',
                color: '#fff',
                fontWeight: 600,
                cursor: submitting ? 'not-allowed' : 'pointer',
              }}
            >
              {submitting ? 'Locking…' : `Confirm — lock ${formatUsdc(stakeRequiredUsdc)}`}
            </button>
            <button
              type="button"
              onClick={() => setStep('form')}
              disabled={submitting}
              style={{
                padding: '0.6rem 1.2rem',
                borderRadius: 8,
                border: '1px solid #cbd5e1',
                background: '#fff',
                fontWeight: 600,
                cursor: submitting ? 'not-allowed' : 'pointer',
              }}
            >
              Back
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={onReview}
          disabled={!canSubmit}
          style={{
            padding: '0.6rem 1.4rem',
            borderRadius: 8,
            border: 'none',
            background: canSubmit ? '#1f2937' : '#9ca3af',
            color: '#fff',
            fontWeight: 600,
            cursor: canSubmit ? 'pointer' : 'not-allowed',
          }}
        >
          Accept Bet
        </button>
      )}
    </div>
  );
}
