import { asc, eq } from 'drizzle-orm';
import { bets, betParticipants, betRules, betShareLinks, betTemplates } from '@rivlayx/db';
import type { ArbiterType, ResolveType } from '@rivlayx/db';
import { potUsdc } from './query';
import type { MarketplaceBetDetail } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MarketplaceDb = any;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Human-readable resolution method for the detail page. */
export function resolutionMethod(
  resolveType: ResolveType,
  arbiterType: ArbiterType,
  resolveSource: unknown,
): string {
  switch (resolveType) {
    case 'auto': {
      const provider = (resolveSource as { provider?: string } | null)?.provider;
      return provider ? `Automatic — ${provider}` : 'Automatic (provider feed)';
    }
    case 'evidence':
      return 'Evidence-based';
    case 'arbiter':
      if (arbiterType === 'platform_selected') return 'Arbiter — platform-selected';
      if (arbiterType === 'user_selected') return 'Arbiter — user-selected';
      return 'Arbiter';
  }
}

/**
 * Resolve a bet id from a UUID, a short code, or a share-link slug. The
 * canonical share link uses `slug = short_code`, so short code lookup covers
 * most cases; the slug fallback handles any extra share links created later.
 */
async function resolveBetId(db: MarketplaceDb, idOrCode: string): Promise<string | null> {
  if (UUID_RE.test(idOrCode)) {
    const [row] = await db.select({ id: bets.id }).from(bets).where(eq(bets.id, idOrCode)).limit(1);
    return row?.id ?? null;
  }

  const [byCode] = await db
    .select({ id: bets.id })
    .from(bets)
    .where(eq(bets.shortCode, idOrCode))
    .limit(1);
  if (byCode) return byCode.id;

  const [bySlug] = await db
    .select({ betId: betShareLinks.betId })
    .from(betShareLinks)
    .where(eq(betShareLinks.slug, idOrCode))
    .limit(1);
  return bySlug?.betId ?? null;
}

/**
 * Full marketplace detail for one bet, resolvable by UUID / short code / share
 * slug. Returns `null` for unknown bets or DRAFT bets (not publicly visible).
 */
export async function getMarketplaceBet(
  db: MarketplaceDb,
  idOrCode: string,
): Promise<MarketplaceBetDetail | null> {
  const betId = await resolveBetId(db, idOrCode);
  if (!betId) return null;

  const [row] = await db
    .select({
      id: bets.id,
      shortCode: bets.shortCode,
      title: bets.title,
      description: bets.description,
      category: betTemplates.category,
      betType: bets.betType,
      status: bets.status,
      resolveType: bets.resolveType,
      arbiterType: bets.arbiterType,
      resolveSource: bets.resolveSource,
      stakePerSideUsdc: bets.stakePerSideUsdc,
      createdAt: bets.createdAt,
      expiresAt: bets.expiresAt,
      eventAt: bets.eventAt,
    })
    .from(bets)
    .leftJoin(betTemplates, eq(betTemplates.id, bets.templateId))
    .where(eq(bets.id, betId))
    .limit(1);

  if (!row || row.status === 'DRAFT') return null;

  const ruleRows = await db
    .select({
      ruleIndex: betRules.ruleIndex,
      display: betRules.display,
      predicate: betRules.predicate,
    })
    .from(betRules)
    .where(eq(betRules.betId, betId))
    .orderBy(asc(betRules.ruleIndex));

  const participantRows = await db
    .select({
      role: betParticipants.role,
      side: betParticipants.side,
      stakeLockedUsdc: betParticipants.stakeLockedUsdc,
    })
    .from(betParticipants)
    .where(eq(betParticipants.betId, betId))
    .orderBy(asc(betParticipants.joinedAt));

  return {
    id: row.id,
    shortCode: row.shortCode,
    title: row.title,
    description: row.description,
    category: row.category ?? 'open_objective',
    betType: row.betType,
    status: row.status,
    resolveType: row.resolveType,
    arbiterType: row.arbiterType,
    resolutionMethod: resolutionMethod(row.resolveType, row.arbiterType, row.resolveSource),
    stakePerSideUsdc: row.stakePerSideUsdc,
    potUsdc: potUsdc(row.stakePerSideUsdc),
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    eventAt: row.eventAt,
    rules: ruleRows.map((r: { ruleIndex: number; display: string; predicate: unknown }) => ({
      ruleIndex: r.ruleIndex,
      display: r.display,
      predicate: r.predicate,
    })),
    participants: participantRows.map(
      (p: { role: string; side: string; stakeLockedUsdc: string }) => ({
        role: p.role,
        side: p.side,
        stakeLockedUsdc: p.stakeLockedUsdc,
      }),
    ),
    sharePath: `/b/${row.shortCode}`,
  };
}
