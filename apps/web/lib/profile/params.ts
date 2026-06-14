import { profiles } from '@rivlayx/core';

export interface ParsedProfileParams {
  filter: profiles.ProfileBetFilter;
  sort: profiles.ProfileBetSort;
  page: number;
}

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Parse + clamp profile bet-history query params, falling back to defaults. */
export function parseProfileParams(sp: SearchParams): ParsedProfileParams {
  const filterRaw = first(sp['filter']) ?? '';
  const sortRaw = first(sp['sort']) ?? '';
  const pageRaw = first(sp['page']);

  const filter = (profiles.profileBetFilterValues as readonly string[]).includes(filterRaw)
    ? (filterRaw as profiles.ProfileBetFilter)
    : 'all';
  const sort = (profiles.profileBetSortValues as readonly string[]).includes(sortRaw)
    ? (sortRaw as profiles.ProfileBetSort)
    : 'newest';
  const page = Math.max(1, Number(pageRaw) || 1);

  return { filter, sort, page };
}

/** Build a profile URL preserving filter/sort/page, overriding some keys. */
export function buildProfileHref(
  basePath: string,
  current: ParsedProfileParams,
  overrides: Partial<ParsedProfileParams> = {},
): string {
  const merged = { ...current, ...overrides };
  const qs = new URLSearchParams();
  if (merged.filter !== 'all') qs.set('filter', merged.filter);
  if (merged.sort !== 'newest') qs.set('sort', merged.sort);
  if (merged.page > 1) qs.set('page', String(merged.page));
  const query = qs.toString();
  return query ? `${basePath}?${query}` : basePath;
}
