'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatUsdc } from '@/lib/marketplace/format';
import { validateWithdrawalInput } from '@/lib/withdrawals/request';

export interface WithdrawFormProps {
  /** Available balance, decimal string. */
  availableUsdc: string;
  /** Pre-fill the user's primary linked wallet, if any. */
  defaultWallet: string;
}

const input: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.65rem',
  borderRadius: 8,
  border: '1px solid #cbd5e1',
  fontSize: 14,
  boxSizing: 'border-box',
};
const labelStyle: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.6,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  display: 'block',
  marginBottom: 6,
};

export function WithdrawForm({ availableUsdc, defaultWallet }: WithdrawFormProps) {
  const router = useRouter();
  const [amount, setAmount] = useState('');
  const [wallet, setWallet] = useState(defaultWallet);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ amountUsdc: string } | null>(null);

  async function onSubmit() {
    setError(null);
    const check = validateWithdrawalInput({
      amountUsdc: amount,
      destinationWallet: wallet,
      availableUsdc,
      withdrawalsFrozen: false, // server is authoritative on freeze
    });
    if (!check.ok) return setError(check.message);

    setSubmitting(true);
    try {
      const res = await fetch('/api/withdrawals', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amountUsdc: amount.trim(), destinationWallet: wallet.trim() }),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const message =
          (data as { error?: { message?: string } } | null)?.error?.message ??
          `Request failed (${res.status})`;
        setError(message);
        return;
      }
      setDone({ amountUsdc: amount.trim() });
      router.refresh();
    } catch {
      setError('Network error — please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
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
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Withdrawal requested ✅</h2>
        <p style={{ marginTop: 0, fontSize: 14, opacity: 0.8 }}>
          Your request for <strong>{formatUsdc(done.amountUsdc)}</strong> is{' '}
          <strong>pending review</strong>. An admin will verify and pay it out manually.
        </p>
      </div>
    );
  }

  const overBalance = Number(amount) > Number(availableUsdc);

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <div style={{ marginBottom: '1.1rem' }}>
        <label htmlFor="wd-amount" style={labelStyle}>
          Amount (USDC)
        </label>
        <input
          id="wd-amount"
          type="number"
          min="0"
          step="0.000001"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          style={input}
        />
        <p style={{ margin: '6px 0 0', fontSize: 12, opacity: 0.55 }}>
          Available:{' '}
          <strong style={{ color: overBalance ? '#b91c1c' : undefined }}>
            {formatUsdc(availableUsdc)}
          </strong>
        </p>
      </div>

      <div style={{ marginBottom: '1.1rem' }}>
        <label htmlFor="wd-wallet" style={labelStyle}>
          Destination Solana wallet
        </label>
        <input
          id="wd-wallet"
          type="text"
          value={wallet}
          maxLength={64}
          onChange={(e) => setWallet(e.target.value)}
          placeholder="Your USDC wallet address"
          style={input}
        />
        <p style={{ margin: '6px 0 0', fontSize: 12, opacity: 0.55 }}>
          Double-check this address — payouts are manual and irreversible.
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
        onClick={onSubmit}
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
        {submitting ? 'Submitting…' : 'Request withdrawal'}
      </button>
    </div>
  );
}
