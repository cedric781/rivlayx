/** Build a `/bets` href by merging overrides onto the current search params. */
const KEYS = ['section', 'q', 'category', 'sport', 'resolveType', 'minStake', 'maxStake', 'page', 'pageSize'] as const;
type Key = (typeof KEYS)[number];

export type RawSearchParams = Record<string, string | string[] | undefined>;

function single(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.length > 0 ? s : undefined;
}

/**
 * Returns `/bets?...` with `overrides` applied. An override of `undefined`
 * clears that key. Any override that changes a filter resets pagination unless
 * `page` is itself overridden.
 */
export function betsHref(current: RawSearchParams, overrides: Partial<Record<Key, string | undefined>>): string {
  const params = new URLSearchParams();
  const resetsPage = Object.keys(overrides).some((k) => k !== 'page');

  for (const key of KEYS) {
    if (key in overrides) continue;
    if (key === 'page' && resetsPage && !('page' in overrides)) continue;
    const value = single(current[key]);
    if (value !== undefined) params.set(key, value);
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined && value !== '') params.set(key, value);
  }

  const qs = params.toString();
  return qs ? `/bets?${qs}` : '/bets';
}
