import { notFound } from 'next/navigation';
import { marketplace } from '@rivlayx/core';
import { getDb } from '@/lib/db';
import { BetDetailView } from '@/components/marketplace/bet-detail-view';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bet = await marketplace.getMarketplaceBet(getDb(), id);
  return { title: bet ? `${bet.title} — RivlayX` : 'Bet not found — RivlayX' };
}

/** Bet detail by UUID or short code. (`/b/<code>` is the share-tracked variant.) */
export default async function BetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bet = await marketplace.getMarketplaceBet(getDb(), id);
  if (!bet) notFound();
  return <BetDetailView bet={bet} />;
}
