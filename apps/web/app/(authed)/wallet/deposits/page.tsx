import Link from 'next/link';
import { desc, eq } from 'drizzle-orm';
import { requireSession } from '@rivlayx/auth/next';
import { deposits as depositsTable } from '@rivlayx/db';
import { getDb } from '@/lib/db';
import { getEnv } from '@/lib/env';
import { DepositsTable } from '@/components/wallet/deposits-table';

export const metadata = { title: 'Deposit history — RivlayX' };

const PAGE_SIZE = 50;

export default async function DepositsPage() {
  const env = getEnv();
  const { user } = await requireSession(getDb, { app: 'user', loginPath: '/login' });
  const db = getDb();

  const rows = await db
    .select()
    .from(depositsTable)
    .where(eq(depositsTable.userId, user.id))
    .orderBy(desc(depositsTable.detectedAt))
    .limit(PAGE_SIZE);

  return (
    <main style={{ maxWidth: 980, margin: '2rem auto', padding: '0 1rem' }}>
      <div style={{ marginBottom: '1rem' }}>
        <Link href="/wallet" style={{ color: '#5b8def', fontSize: 13 }}>
          ← Back to wallet
        </Link>
      </div>

      <h1>Deposit history</h1>
      <p style={{ opacity: 0.6, fontSize: 14, marginTop: 0 }}>
        Showing the {PAGE_SIZE} most recent. Full pagination arrives in Sprint 6+.
      </p>

      <div style={{ marginTop: '1.5rem' }}>
        <DepositsTable deposits={rows} network={env.SOLANA_NETWORK} />
      </div>
    </main>
  );
}
