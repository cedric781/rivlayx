import { notFound } from 'next/navigation';
import { marketplace } from '@rivlayx/core';
import { getDb } from '@/lib/db';
import { BetDetailView } from '@/components/marketplace/bet-detail-view';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ shortCode: string }> }) {
  const { shortCode } = await params;
  const bet = await marketplace.getMarketplaceBet(getDb(), shortCode);
  return { title: bet ? `${bet.title} — RivlayX` : 'Bet not found — RivlayX' };
}

/**
 * Preferred share URL. Records a share-link click (slug = short code) for the
 * Trending ranking, then renders the same bet detail as `/bets/<code>`.
 */
export default async function ShareLandingPage({
  params,
}: {
  params: Promise<{ shortCode: string }>;
}) {
  const { shortCode } = await params;
  const db = getDb();
  await marketplace.recordShareLinkClick(db, shortCode);
  const bet = await marketplace.getMarketplaceBet(db, shortCode);
  if (!bet) notFound();
  return <BetDetailView bet={bet} />;
}
