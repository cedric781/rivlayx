import { z } from 'zod';
import { marketplace } from '@rivlayx/core';
import { resolveTypeValues } from '@rivlayx/db';

/**
 * Parse marketplace listing query params from a URLSearchParams (used by both
 * the `/api/bets` route and the `/bets` server page). Unknown / malformed
 * values fall back to sensible defaults rather than erroring, so a hand-typed
 * URL never 500s the marketplace.
 */
const optionalNumber = z
  .union([z.string(), z.number()])
  .optional()
  .transform((v) => {
    if (v === undefined || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  });

const ParamsSchema = z.object({
  section: z.enum(marketplace.marketplaceSectionValues).optional().catch(undefined),
  q: z.string().trim().max(120).optional().catch(undefined),
  category: z.enum(marketplace.categoryFacetValues).optional().catch(undefined),
  sport: z.enum(marketplace.SPORT_CATEGORIES).optional().catch(undefined),
  resolveType: z.enum(resolveTypeValues).optional().catch(undefined),
  minStake: optionalNumber.catch(undefined),
  maxStake: optionalNumber.catch(undefined),
  page: optionalNumber.catch(undefined),
  pageSize: optionalNumber.catch(undefined),
});

export type ParsedMarketplaceParams = marketplace.ListBetsParams;

export function parseMarketplaceParams(
  search: URLSearchParams | Record<string, string | string[] | undefined>,
): ParsedMarketplaceParams {
  const raw: Record<string, unknown> =
    search instanceof URLSearchParams
      ? Object.fromEntries(search.entries())
      : Object.fromEntries(
          Object.entries(search).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
        );

  const parsed = ParamsSchema.parse(raw);
  return {
    section: parsed.section,
    q: parsed.q,
    category: parsed.category,
    sport: parsed.sport,
    resolveType: parsed.resolveType,
    minStake: parsed.minStake,
    maxStake: parsed.maxStake,
    page: parsed.page,
    pageSize: parsed.pageSize,
  };
}
