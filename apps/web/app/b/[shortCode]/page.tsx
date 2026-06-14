import { notFound } from 'next/navigation';
import { ledger, marketplace } from '@rivlayx/core';
import { getDb } from '@/lib/db';
import { getOptionalUser } from '@/lib/auth/optional-session';
import { BetDetailView, type BetDetailViewer } from '@/components/marketplace/bet-detail-view';

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
