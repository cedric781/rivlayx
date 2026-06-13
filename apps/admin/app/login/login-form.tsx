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
};
const buttonStyle = {
  width: '100%',
  padding: '0.6rem',
  background: '#a13a3a',
  color: 'white',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
};

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(data?.error?.message ?? 'Sign-in failed');
      }
      const data = (await res.json()) as { redirect?: string };
      router.push(data.redirect ?? '/dashboard');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <label style={{ display: 'block', marginBottom: '1rem' }}>
        Email
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
          style={inputStyle}
        />
      </label>
      <button type="submit" disabled={busy} style={buttonStyle}>
        {busy ? 'Signing in…' : 'Continue'}
      </button>
      {error && (
        <p role="alert" style={{ color: '#ff6b6b', marginTop: '1rem' }}>
          {error}
        </p>
      )}
    </form>
  );
}
