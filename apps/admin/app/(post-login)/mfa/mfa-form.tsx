'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

const inputStyle = {
  display: 'block',
  width: '100%',
  padding: '0.5rem',
  marginTop: '0.25rem',
  background: '#1a1d21',
  color: '#e6e8eb',
  border: '1px solid #2c3036',
  borderRadius: 4,
  letterSpacing: '0.4em',
  textAlign: 'center' as const,
};

export function MfaForm() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/mfa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(data?.error?.message ?? 'Invalid code');
      }
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <label style={{ display: 'block', marginBottom: '1rem' }}>
        Code
        <input
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          disabled={busy}
          style={inputStyle}
        />
      </label>
      <button
        type="submit"
        disabled={busy || code.length !== 6}
        style={{
          width: '100%',
          padding: '0.6rem',
          background: '#a13a3a',
          color: 'white',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
        }}
      >
        {busy ? 'Verifying…' : 'Verify'}
      </button>
      {error && (
        <p role="alert" style={{ color: '#ff6b6b', marginTop: '1rem' }}>
          {error}
        </p>
      )}
    </form>
  );
}
