'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    setBusy(true);
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <button
      onClick={onClick}
      disabled={busy}
      style={{
        padding: '0.4rem 0.8rem',
        background: 'transparent',
        color: '#e6e8eb',
        border: '1px solid #2c3036',
        borderRadius: 4,
        cursor: 'pointer',
      }}
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
