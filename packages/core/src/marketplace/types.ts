import type { BetStatus, ResolveType, ArbiterType, BetType, ReputationTier } from '@rivlayx/db';

/**
 * Marketplace is a read-only projection over the bet engine. It never mutates
 * bet state — the only write it owns is incrementing share-link engagement
 * counters (see `share.ts`), which feeds the Trending ranking.
 */

// ───────────── sections + sorting ─────────────

export const marketplaceSectionValues = [
  'trending',
  'newest',
  'expiring_soon',
  'highest_stakes',
] as const;
export type MarketplaceSection = (typeof marketplaceSectionValues)[number];

// ───────────── category facet ─────────────

/** Template categories that count as "sport" for the Sport facet. */
export const SPORT_CATEGORIES = ['football', 'basketball', 'hockey', 'tennis', 'mma'] as const;
export type SportCategory = (typeof SPORT_CATEGORIES)[number];

export const CRYPTO_CATEGORY = 'crypto' as const;

/**
 * High-level marketplace facet. `sport` / `crypto` resolve through the joined
 * `bet_templates.category`; `open_objective` is the template-less free-form bet
 * (`bets.template_id IS NULL`).
 */
export const categoryFacetValues = ['sport', 'crypto', 'open_objective'] as const;
export type CategoryFacet = (typeof categoryFacetValues)[number];

// ───────────── list params ─────────────

export interface ListBetsParams {
  section?: MarketplaceSection;
  /** Case-insensitive substring match on title + description. */
  q?: string;
  /** High-level facet (sport / crypto / open_objective). */
  category?: CategoryFacet;
  /** Narrow to one specific sport category, e.g. `football`. Refines `category`. */
  sport?: SportCategory;
  resolveType?: ResolveType;
  /** Exact creator-reputation tier filter (Sprint 16). `new` includes creators with no snapshot yet. */
  tier?: ReputationTier;
  /** Inclusive stake-per-side bounds in USDC (decimal strings or numbers). */
  minStake?: string | number;
  maxStake?: string | number;
  /** 1-based page index. */
  page?: number;
  pageSize?: number;
  /** Anchor for the Trending recency component + expiry filter. Defaults to now. */
  now?: Date;
}

export const DEFAULT_PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 100;

// ───────────── list item ─────────────

export interface MarketplaceListItem {
  id: string;
  shortCode: string;
  title: string;
  /** Resolved display category: a sport name, `crypto`, or `open_objective`. */
  category: string;
  betType: BetType;
  resolveType: ResolveType;
  status: BetStatus;
  /** Stake per side, decimal string. */
  stakePerSideUsdc: string;
  /** Total pot when fully matched = stake × 2, decimal string. */
  potUsdc: string;
  createdAt: Date;
  expiresAt: Date | null;
  /** Creator's reputation tier (badge only; never a score). */
  creatorTier: ReputationTier;
  creatorProvisional: boolean;
  /** Preferred share path: `/b/<shortCode>`. */
  sharePath: string;
}

export interface ListBetsResult {
  items: MarketplaceListItem[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

// ───────────── detail ─────────────

export interface MarketplaceBetRule {
  ruleIndex: number;
  display: string;
  predicate: unknown;
}

export interface MarketplaceParticipant {
  role: string;
  side: string;
  stakeLockedUsdc: string;
}

export interface MarketplaceBetDetail {
  id: string;
  shortCode: string;
  title: string;
  description: string | null;
  category: string;
  betType: BetType;
  status: BetStatus;
  resolveType: ResolveType;
  arbiterType: ArbiterType;
  /** Human-readable resolution method derived from resolveType + arbiterType. */
  resolutionMethod: string;
  /** Creator's user id — used to stop the creator accepting their own bet. */
  creatorUserId: string;
  /** Side label the creator took. The acceptor must pick a different side. */
  creatorSide: string;
  /**
   * Allowed side labels from the bet's template (`sides_schema`), or `null` for
   * free-form / template-less bets. Drives the accept side selector: exactly one
   * remaining side ⇒ auto-select; more (or null) ⇒ show a selector.
   */
  templateSides: string[] | null;
  stakePerSideUsdc: string;
  potUsdc: string;
  createdAt: Date;
  expiresAt: Date | null;
  eventAt: Date | null;
  rules: MarketplaceBetRule[];
  participants: MarketplaceParticipant[];
  /** Creator's reputation tier (badge only; never a score). */
  creatorTier: ReputationTier;
  creatorProvisional: boolean;
  sharePath: string;
}

// ───────────── analytics ─────────────

export interface CategoryStat {
  category: string;
  /** Total bets created in this category. */
  total: number;
  /** Bets that found an acceptor (acceptor_user_id IS NOT NULL). */
  accepted: number;
  /** Bets currently live (OPEN or ACTIVE). */
  active: number;
}

export interface CategoryAnalytics {
  perCategory: CategoryStat[];
  /** Category with the most accepted bets (null when no bets exist). */
  mostAccepted: CategoryStat | null;
  /** Category with the most currently-active bets (null when none). */
  mostActive: CategoryStat | null;
}
