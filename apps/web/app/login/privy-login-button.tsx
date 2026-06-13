'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';

const buttonStyle = {
  width: '100%',
  padding: '0.75rem',
  background: '#5b8def',
  color: 'white',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 16,
  fontWeight: 600,
};

const disabledStyle = {
  ...buttonStyle,
  background: '#2c3036',
  cursor: 'not-allowed',
};

/**
 * Real Privy sign-in. Opens the Privy modal; on success exchanges the access
 * token for our session cookie via `/api/auth/privy/callback`.
 */
export function PrivyLoginButton() {
  const router = useRouter();
  const { ready, authenticated, login, logout, getAccessToken } = usePrivy();
  const [exchanging, setExchanging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !authenticated || exchanging) return;
    let cancelled = false;
    setExchanging(true);

    void (async () => {
      try {
        const token = await getAccessToken();
        if (!token) throw new Error('No access token from Privy');
        const res = await fetch('/api/auth/privy/callback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          throw new Error(data?.error?.message ?? 'Sign-in failed');
        }
        const data = (await res.json()) as { redirect?: string };
        if (cancelled) return;
        router.push(data.redirect ?? '/wallet');
        router.refresh();
      } catch (err) {
        if (cancelled) return;
        setError((err as Error).message);
        await logout();
      } finally {
        if (!cancelled) setExchanging(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, exchanging, getAccessToken, logout, router]);

  if (!ready) {
    return (
      <button style={disabledStyle} disabled>
        Loading…
      </button>
    );
  }
  if (authenticated && exchanging) {
    return (
      <button style={disabledStyle} disabled>
        Signing you in…
      </button>
    );
  }

  return (
    <>
      <button style={buttonStyle} onClick={() => login()}>
        Continue with Privy
      </button>
      {error && (
        <p role="alert" style={{ color: '#ff6b6b', marginTop: '1rem' }}>
          {error}
        </p>
      )}
    </>
  );
}
