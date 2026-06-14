import Decimal from 'decimal.js';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { bets, betShareLinks, betTemplates, userReputation } from '@rivlayx/db';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  SPORT_CATEGORIES,
  type ListBetsParams,
  type ListBetsResult,
  type MarketplaceListItem,
} from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MarketplaceDb = any;

/** Total pot when a bet is fully matched: stake per side × 2. */
export function potUsdc(stakePerSideUsdc: string): string {
  return new Decimal(stakePerSideUsdc).mul(2).toFixed(6);
}

/** Escape LIKE wildcards so user search input can't inject `%`/`_` patterns. */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function clampPageSize(pageSize: number | undefined): number {
  if (!pageSize || !Number.isFinite(pageSize) || pageSize < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.floor(pageSize), MAX_PAGE_SIZE);
}

function clampPage(page: number | undefined): number {
  if (!page || !Number.isFinite(page) || page < 1) return 1;
  return Math.floor(page);
}

/**
 * Build the WHERE conditions shared by the list query and its COUNT. Only the
 * `bets` and `bet_templates` tables are referenced here, so both queries can
 * reuse it with just the templates join.
 */
function buildConditions(params: ListBetsParams, now: Date): SQL[] {
  const conditions: SQL[] = [eq(bets.status, 'OPEN')];

  // Open + not-yet-expired. Expiring-soon section requires a real deadline.
  if (params.section === 'expiring_soon') {
    conditions.push(gt(bets.expiresAt, now));
  } else {
    conditions.push(or(isNull(bets.expiresAt), gt(bets.expiresAt, now))!);
  }

  // Category facet (sport / crypto / open_objective) + optional specific sport.
  if (params.sport) {
    conditions.push(eq(betTemplates.category, params.sport));
  } else if (params.category === 'open_objective') {
    conditions.push(isNull(bets.templateId));
  } else if (params.category === 'crypto') {
    conditions.push(eq(betTemplates.category, 'crypto'));
  } else if (params.category === 'sport') {
    conditions.push(inArray(betTemplates.category, [...SPORT_CATEGORIES]));
  }

  if (params.resolveType) {
    conditions.push(eq(bets.resolveType, params.resolveType));
  }

  if (params.q && params.q.trim().length > 0) {
    const pattern = `%${escapeLike(params.q.trim())}%`;
    conditions.push(or(ilike(bets.title, pattern), ilike(bets.description, pattern))!);
  }

  if (params.minStake !== undefined && params.minStake !== null && `${params.minStake}` !== '') {
    conditions.push(sql`${bets.stakePerSideUsdc} >= ${String(params.minStake)}::numeric`);
  }
  if (params.maxStake !== undefined && params.maxStake !== null && `${params.maxStake}` !== '') {
    conditions.push(sql`${bets.stakePerSideUsdc} <= ${String(params.maxStake)}::numeric`);
  }

  return conditions;
}

/**
 * Marketplace listing of acceptable (OPEN, not-expired) bets, with search,
 * category/resolve/stake filters, section sorting, and offset pagination.
 *
 * Trending ranks by share-link engagement (clicks + conversions) blended with a
 * recency boost that decays over 48h, so fresh-but-quiet bets still surface.
 */
export async function listMarketplaceBets(
  db: MarketplaceDb,
  params: ListBetsParams = {},
): Promise<ListBetsResult> {
  const now = params.now ?? new Date();
  const page = clampPage(params.page);
  const pageSize = clampPageSize(params.pageSize);
  const conditions = buildConditions(params, now);
  const where = and(...conditions);

  // Per-bet engagement aggregate (a bet may have multiple share links).
  const shareAgg = db
    .select({
      betId: betShareLinks.betId,
      engagement:
        sql<number>`sum(${betShareLinks.clicks} + ${betShareLinks.conversions})`.as('engagement'),
    })
    .from(betShareLinks)
    .groupBy(betShareLinks.betId)
    .as('share_agg');

  const section = params.section ?? 'newest';
  const tiebreak = [desc(bets.createdAt), desc(bets.id)];
  let orderBy: SQL[] | ReturnType<typeof desc>[];
  switch (section) {
    case 'expiring_soon':
      orderBy = [asc(bets.expiresAt), ...tiebreak];
      break;
    case 'highest_stakes':
      orderBy = [desc(bets.stakePerSideUsdc), ...tiebreak];
      break;
    case 'trending': {
      const recency = sql`greatest(0, 48 - extract(epoch from (${now}::timestamptz - ${bets.createdAt})) / 3600)`;
      orderBy = [sql`(coalesce(${shareAgg.engagement}, 0) + ${recency}) desc`, ...tiebreak];
      break;
    }
    case 'newest':
    default:
      orderBy = [...tiebreak];
      break;
  }

  const rows = await db
    .select({
      id: bets.id,
      shortCode: bets.shortCode,
      title: bets.title,
      category: betTemplates.category,
      betType: bets.betType,
      resolveType: bets.resolveType,
      status: bets.status,
      stakePerSideUsdc: bets.stakePerSideUsdc,
      createdAt: bets.createdAt,
      expiresAt: bets.expiresAt,
      creatorTier: userReputation.tier,
      creatorProvisional: userReputation.provisional,
    })
    .from(bets)
    .leftJoin(betTemplates, eq(betTemplates.id, bets.templateId))
    .leftJoin(shareAgg, eq(shareAgg.betId, bets.id))
    .leftJoin(userReputation, eq(userReputation.userId, bets.creatorUserId))
    .where(where)
    .orderBy(...orderBy)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const [{ value: total }] = await db
    .select({ value: count() })
    .from(bets)
    .leftJoin(betTemplates, eq(betTemplates.id, bets.templateId))
    .where(where);

  const items: MarketplaceListItem[] = rows.map((r: (typeof rows)[number]) => ({
    id: r.id,
    shortCode: r.shortCode,
    title: r.title,
    category: r.category ?? 'open_objective',
    betType: r.betType,
    resolveType: r.resolveType,
    status: r.status,
    stakePerSideUsdc: r.stakePerSideUsdc,
    potUsdc: potUsdc(r.stakePerSideUsdc),
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    creatorTier: r.creatorTier ?? 'new',
    creatorProvisional: r.creatorProvisional ?? true,
    sharePath: `/b/${r.shortCode}`,
  }));

  return {
    items,
    page,
    pageSize,
    total: Number(total),
    hasMore: (page - 1) * pageSize + items.length < Number(total),
  };
}
