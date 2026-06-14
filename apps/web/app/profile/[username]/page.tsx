import { notFound } from 'next/navigation';
import { profiles } from '@rivlayx/core';
import { getDb } from '@/lib/db';
import { getOptionalUser } from '@/lib/auth/optional-session';
import { parseProfileParams } from '@/lib/profile/params';
import { ProfileView } from '@/components/profile/profile-view';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const user = await profiles.getPublicUserByUsername(getDb(), username);
  return { title: user ? `@${user.username} — RivlayX` : 'Profile not found — RivlayX' };
}

/** Public profile by username. Never exposes email / privyId / wallets. */
export default async function PublicProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { username } = await params;
  const db = getDb();

  const summary = await profiles.getPublicUserByUsername(db, username);
  if (!summary) notFound();

  const parsed = parseProfileParams(await searchParams);
  const [stats, bets, viewer] = await Promise.all([
    profiles.getProfileStats(db, summary.id),
    profiles.listProfileBets(db, summary.id, parsed),
    getOptionalUser(),
  ]);

  return (
    <ProfileView
      user={summary}
      stats={stats}
      bets={bets}
      params={parsed}
      basePath={`/profile/${summary.username}`}
      isOwn={viewer?.id === summary.id}
    />
  );
}
