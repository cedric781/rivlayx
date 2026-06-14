import Link from 'next/link';
import { reputation } from '@rivlayx/core';
import { getDb } from '@/lib/db';
import { ReputationBadge } from '@/components/reputation/reputation-badge';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Top Arbiters — RivlayX' };

/** Format a 0–1 decimal-string rate as a percentage. */
function pct(rate: string): string {
  return `${(Number(rate) * 100).toFixed(1)}%`;
}

const cell: React.CSSProperties = { fontSize: 13, opacity: 0.8 };

/** Public leaderboard of arbiters by adjudicator trust. No raw scores shown. */
export default async function ArbitersPage() {
  const arbiters = await reputation.listTopArbiters(getDb(), { limit: 50 });

  return (
    <main style={{ maxWidth: 820, margin: '2rem auto', padding: '0 1rem' }}>
      <h1 style={{ marginBottom: '0.25rem' }}>Top Arbiters</h1>
      <p style={{ opacity: 0.7, marginTop: 0 }}>
        Arbiters ranked by adjudication trust — acceptance, ruling volume, and how rarely their
        rulings are overturned.
      </p>

      {arbiters.length === 0 ? (
        <p style={{ opacity: 0.6 }}>No arbiters have ruled yet.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: '1.25rem 0 0' }}>
          {arbiters.map((a, i) => (
            <li
              key={a.userId}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
                border: '1px solid #e5e7eb',
                borderRadius: 10,
                padding: '0.7rem 1rem',
                marginBottom: '0.6rem',
                background: '#fff',
              }}
            >
              <span style={{ width: 24, textAlign: 'right', opacity: 0.5, fontWeight: 700 }}>
                {i + 1}
              </span>
              <Link
                href={`/profile/${a.username}`}
                style={{ fontWeight: 600, color: '#1f2937', textDecoration: 'none', minWidth: 140 }}
              >
                {a.displayName ?? `@${a.username}`}
              </Link>
              <ReputationBadge tier={a.arbiterTier} provisional={a.arbiterProvisional} size="sm" />
              <span style={{ ...cell, marginLeft: 'auto' }}>{a.arbiterRulings} rulings</span>
              <span style={cell}>Acceptance {pct(a.acceptanceRate)}</span>
              <span style={cell}>Overturned {pct(a.overturnedRate)}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
