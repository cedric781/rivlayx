import { count, eq, sql } from 'drizzle-orm';
import { bets, betTemplates } from '@rivlayx/db';
import type { CategoryAnalytics, CategoryStat } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MarketplaceDb = any;

/**
 * Per-category bet counts plus the leading categories by acceptance and by
 * live activity. Category is the joined template category, or `open_objective`
 * for template-less bets. Read-only aggregate intended for an analytics/admin
 * surface — it does not constrain by status so trends cover the full history.
 */
export async function getCategoryAnalytics(db: MarketplaceDb): Promise<CategoryAnalytics> {
  const categoryExpr = sql<string>`coalesce(${betTemplates.category}, 'open_objective')`;

  const rows = await db
    .select({
      category: categoryExpr,
      total: count(),
      accepted: sql<number>`count(${bets.acceptorUserId})`,
      active: sql<number>`count(*) filter (where ${bets.status} in ('OPEN', 'ACTIVE'))`,
    })
    .from(bets)
    .leftJoin(betTemplates, eq(betTemplates.id, bets.templateId))
    .groupBy(categoryExpr);

  const perCategory: CategoryStat[] = rows
    .map((r: { category: string; total: number; accepted: number; active: number }) => ({
      category: r.category,
      total: Number(r.total),
      accepted: Number(r.accepted),
      active: Number(r.active),
    }))
    .sort((a: CategoryStat, b: CategoryStat) => b.total - a.total || a.category.localeCompare(b.category));

  const mostAccepted = perCategory.reduce<CategoryStat | null>((best, cur) => {
    if (cur.accepted === 0) return best;
    if (!best || cur.accepted > best.accepted) return cur;
    return best;
  }, null);

  const mostActive = perCategory.reduce<CategoryStat | null>((best, cur) => {
    if (cur.active === 0) return best;
    if (!best || cur.active > best.active) return cur;
    return best;
  }, null);

  return { perCategory, mostAccepted, mostActive };
}
