import { notFound } from 'next/navigation';
import { ledger, marketplace } from '@rivlayx/core';
import { getDb } from '@/lib/db';
import { getOptionalUser } from '@/lib/auth/optional-session';
import { BetDetailView, type BetDetailViewer } from '@/components/marketplace/bet-detail-view';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bet = await marketplace.getMarketplaceBet(getDb(), id);
  return { title: bet ? `${bet.title} — RivlayX` : 'Bet not found — RivlayX' };
}

/** Bet detail by UUID or short code. (`/b/<code>` is the share-tracked variant.) */
export default async function BetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const bet = await marketplace.getMarketplaceBet(db, id);
  if (!bet) notFound();

  const viewer = await resolveViewer();
  return <BetDetailView bet={bet} viewer={viewer} />;
}

/** Build the signed-in viewer context (with balance), or null if anonymous. */
async function resolveViewer(): Promise<BetDetailViewer | null> {
  const user = await getOptionalUser();
  if (!user) return null;
  const balance = await ledger.getBalance(getDb(), user.id);
  return { userId: user.id, availableUsdc: balance?.availableUsdc ?? '0' };
}
