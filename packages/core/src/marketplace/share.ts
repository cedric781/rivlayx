import { eq, sql } from 'drizzle-orm';
import { betShareLinks } from '@rivlayx/db';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MarketplaceDb = any;

export interface ShareEngagement {
  slug: string;
  betId: string;
  clicks: number;
  conversions: number;
}

/**
 * Atomically increment a share link's click counter. Returns the updated
 * engagement, or `null` when the slug is unknown. Feeds the Trending ranking;
 * never touches bet state or money.
 */
export async function recordShareLinkClick(
  db: MarketplaceDb,
  slug: string,
): Promise<ShareEngagement | null> {
  const [row] = await db
    .update(betShareLinks)
    .set({ clicks: sql`${betShareLinks.clicks} + 1` })
    .where(eq(betShareLinks.slug, slug))
    .returning({
      slug: betShareLinks.slug,
      betId: betShareLinks.betId,
      clicks: betShareLinks.clicks,
      conversions: betShareLinks.conversions,
    });
  return row ?? null;
}

/**
 * Atomically increment a share link's conversion counter (a click that led to
 * a bet acceptance). Returns the updated engagement, or `null` when unknown.
 */
export async function recordShareLinkConversion(
  db: MarketplaceDb,
  slug: string,
): Promise<ShareEngagement | null> {
  const [row] = await db
    .update(betShareLinks)
    .set({ conversions: sql`${betShareLinks.conversions} + 1` })
    .where(eq(betShareLinks.slug, slug))
    .returning({
      slug: betShareLinks.slug,
      betId: betShareLinks.betId,
      clicks: betShareLinks.clicks,
      conversions: betShareLinks.conversions,
    });
  return row ?? null;
}
