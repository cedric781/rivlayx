import { notFound } from 'next/navigation';
import { requireSession } from '@rivlayx/auth/next';
import { profiles, reputation } from '@rivlayx/core';
import { getDb } from '@/lib/db';
import { parseProfileParams } from '@/lib/profile/params';
import { ProfileView } from '@/components/profile/profile-view';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your profile — RivlayX' };

type SearchParams = Record<string, string | string[] | undefined>;

/** The signed-in user's own profile. */
export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { user } = await requireSession(getDb, { app: 'user', loginPath: '/login' });
  const db = getDb();

  const summary = await profiles.getPublicUserById(db, user.id);
  if (!summary) notFound();

  const params = parseProfileParams(await searchParams);
  const [stats, bets, rep] = await Promise.all([
    profiles.getProfileStats(db, user.id),
    profiles.listProfileBets(db, user.id, params),
    reputation.getReputation(db, user.id),
  ]);

  return (
    <ProfileView
      user={summary}
      rep={rep}
      stats={stats}
      bets={bets}
      params={params}
      basePath="/profile"
      isOwn
    />
  );
}
