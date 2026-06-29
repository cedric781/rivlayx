import Link from 'next/link';

export const metadata = {
  title: 'RivlayX — Objective wagering on Solana / USDC',
  description:
    'Create or take peer-to-peer bets on objectively verifiable outcomes. Stakes are locked in USDC until the result decides the winner.',
};

const page: React.CSSProperties = {
  maxWidth: 960,
  margin: '0 auto',
  padding: 'var(--rx-space-8) var(--rx-space-5)',
};

const eyebrow: React.CSSProperties = {
  fontSize: 'var(--rx-font-size-xs)',
  textTransform: 'uppercase',
  letterSpacing: 'var(--rx-letter-spacing-wide)',
  color: 'var(--rx-color-primary)',
  fontWeight: 600,
  margin: 0,
};

const primaryCta: React.CSSProperties = {
  display: 'inline-block',
  padding: '0.7rem 1.6rem',
  borderRadius: 'var(--rx-radius-lg)',
  background: 'var(--rx-color-primary)',
  color: 'var(--rx-color-primary-contrast)',
  fontWeight: 600,
  textDecoration: 'none',
};

const secondaryCta: React.CSSProperties = {
  display: 'inline-block',
  padding: '0.7rem 1.6rem',
  borderRadius: 'var(--rx-radius-lg)',
  background: 'transparent',
  color: 'var(--rx-color-text)',
  border: '1px solid var(--rx-color-border)',
  fontWeight: 600,
  textDecoration: 'none',
};

const textLink: React.CSSProperties = {
  color: 'var(--rx-color-primary)',
  textDecoration: 'none',
  fontSize: 'var(--rx-font-size-base)',
  fontWeight: 500,
};

const sectionTitle: React.CSSProperties = {
  fontSize: 'var(--rx-font-size-xl)',
  fontWeight: 700,
  margin: 0,
};

const card: React.CSSProperties = {
  background: 'var(--rx-color-surface)',
  border: '1px solid var(--rx-color-border)',
  borderRadius: 'var(--rx-radius-xl)',
  padding: 'var(--rx-space-5)',
};

const cardGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: 'var(--rx-space-4)',
  marginTop: 'var(--rx-space-5)',
};

const cardBody: React.CSSProperties = {
  fontSize: 'var(--rx-font-size-base)',
  color: 'var(--rx-color-text-muted)',
  margin: 0,
  lineHeight: 'var(--rx-line-normal)',
};

const STEPS = [
  {
    step: '1',
    title: 'Create or pick a bet',
    body: 'Propose a question with a clear, objectively verifiable outcome — or take the open side of someone else’s bet from the marketplace.',
  },
  {
    step: '2',
    title: 'Lock your stake',
    body: 'Both sides lock their USDC stake. The funds stay locked and visible in your balance until the bet closes and resolves.',
  },
  {
    step: '3',
    title: 'The result decides',
    body: 'Once the outcome is determined, the winner is credited the full pot. A dispute window protects both sides before settlement.',
  },
];

const TRUST = [
  {
    title: 'Objective by design',
    body: 'Every bet must state a measurable outcome — subjective wording is discouraged at creation, so results come down to facts, not opinions.',
  },
  {
    title: 'Funds held while live',
    body: 'When you join a bet your USDC stake moves to a locked balance. Your available and locked amounts are always visible in your wallet.',
  },
  {
    title: 'Reviewed withdrawals',
    body: 'Payouts to your own Solana wallet are verified before they are sent — irreversible transfers are never made on autopilot.',
  },
];

export default function HomePage() {
  return (
    <main style={page}>
      {/* Hero */}
      <section style={{ textAlign: 'center', paddingTop: 'var(--rx-space-6)' }}>
        <p style={eyebrow}>RivlayX</p>
        <h1
          style={{
            fontSize: 'clamp(2rem, 6vw, 3.25rem)',
            lineHeight: 'var(--rx-line-tight)',
            margin: 'var(--rx-space-3) auto 0',
            maxWidth: 760,
          }}
        >
          Settle the bet, not the argument.
        </h1>
        <p
          style={{
            fontSize: 'clamp(1rem, 2.5vw, 1.25rem)',
            color: 'var(--rx-color-text-muted)',
            margin: 'var(--rx-space-4) auto 0',
            maxWidth: 620,
            lineHeight: 'var(--rx-line-normal)',
          }}
        >
          Peer-to-peer wagering on objectively verifiable outcomes. Both sides lock USDC, the stakes
          stay held until the bet resolves, and the result pays the winner — no bookmaker, no spread.
        </p>
        <div
          style={{
            marginTop: 'var(--rx-space-6)',
            display: 'flex',
            gap: 'var(--rx-space-4)',
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}
        >
          <Link href="/bets" style={primaryCta}>
            Browse bets
          </Link>
          <Link href="/bets/new" style={secondaryCta}>
            Create a bet
          </Link>
        </div>
        <p style={{ marginTop: 'var(--rx-space-4)' }}>
          <Link href="/login" style={textLink}>
            Sign in →
          </Link>
        </p>
      </section>

      {/* How it works */}
      <section style={{ marginTop: 'var(--rx-space-8)' }}>
        <h2 style={sectionTitle}>How it works</h2>
        <div style={cardGrid}>
          {STEPS.map((s) => (
            <div key={s.step} style={card}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 'var(--rx-radius-pill)',
                  background: 'var(--rx-color-primary)',
                  color: 'var(--rx-color-primary-contrast)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                }}
              >
                {s.step}
              </div>
              <h3
                style={{
                  fontSize: 'var(--rx-font-size-md)',
                  margin: 'var(--rx-space-3) 0 var(--rx-space-2)',
                }}
              >
                {s.title}
              </h3>
              <p style={cardBody}>{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Trust & safety */}
      <section style={{ marginTop: 'var(--rx-space-8)' }}>
        <h2 style={sectionTitle}>Built for trust</h2>
        <p
          style={{
            fontSize: 'var(--rx-font-size-base)',
            color: 'var(--rx-color-text-muted)',
            margin: 'var(--rx-space-2) 0 0',
            maxWidth: 620,
            lineHeight: 'var(--rx-line-normal)',
          }}
        >
          Objective outcomes and transparent USDC handling keep every bet fair on both sides.
        </p>
        <div style={cardGrid}>
          {TRUST.map((t) => (
            <div key={t.title} style={card}>
              <h3
                style={{
                  fontSize: 'var(--rx-font-size-md)',
                  margin: '0 0 var(--rx-space-2)',
                }}
              >
                {t.title}
              </h3>
              <p style={cardBody}>{t.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Closing CTA */}
      <section
        style={{
          marginTop: 'var(--rx-space-8)',
          textAlign: 'center',
          padding: 'var(--rx-space-6) var(--rx-space-5)',
          background: 'var(--rx-color-surface)',
          border: '1px solid var(--rx-color-border)',
          borderRadius: 'var(--rx-radius-xl)',
        }}
      >
        <h2 style={{ ...sectionTitle, fontSize: 'var(--rx-font-size-2xl)' }}>Ready to back it up?</h2>
        <p
          style={{
            color: 'var(--rx-color-text-muted)',
            margin: 'var(--rx-space-3) auto var(--rx-space-5)',
            maxWidth: 480,
            lineHeight: 'var(--rx-line-normal)',
          }}
        >
          Browse the open marketplace or put your own question on the line.
        </p>
        <div
          style={{
            display: 'flex',
            gap: 'var(--rx-space-4)',
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}
        >
          <Link href="/bets" style={primaryCta}>
            Browse bets
          </Link>
          <Link href="/bets/new" style={secondaryCta}>
            Create a bet
          </Link>
        </div>
      </section>
    </main>
  );
}
