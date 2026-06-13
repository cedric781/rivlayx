import Link from 'next/link';

export default function HomePage() {
  return (
    <main style={{ maxWidth: 720, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>RivlayX</h1>
      <p>Crypto-native objective wagering on Solana / USDC.</p>
      <p style={{ marginTop: '2rem' }}>
        <Link href="/login">Sign in →</Link>
      </p>
      <p style={{ marginTop: '4rem', fontSize: 12, opacity: 0.6 }}>
        Fase 1 MVP — under construction. Mock auth mode; no real money flow yet.
      </p>
    </main>
  );
}
