import type { BetStatus, ResolveType } from '@rivlayx/db';

// ───────────── public user summary ─────────────

/**
 * Public-safe user fields for a profile header. Deliberately excludes email,
 * privyId, wallet addresses, and any other PII.
 */
export interface PublicUserSummary {
  id: string;
  username: string;
  displayName: string | null;
  joinedAt: Date;
}

// ───────────── stats ─────────────

export interface ProfileStats {
  totalBets: number;
  wins: number;
  losses: number;
  /** wins / (wins + losses); 0 when the user has no settled win/loss yet. */
  winRate: number;
  /** Total own capital staked across all participations, decimal string. */
  totalVolumeUsdc: string;
  /** Net profit on won bets = Σ(net payout − own stake), decimal string. */
  totalWinningsUsdc: string;
  /** Own stake lost on lost bets, decimal string. */
  totalLossesUsdc: string;
  activeBets: number;
  openBets: number;
}

// ───────────── bet history ─────────────

export const profileBetFilterValues = [
  'open',
  'active',
  'awaiting',
  'disputed',
  'won',
  'lost',
  'all',
] as const;
export type ProfileBetFilter = (typeof profileBetFilterValues)[number];

export const profileBetSortValues = [
  'newest',
  'oldest',
  'highest_stake',
  'highest_pot',
] as const;
export type ProfileBetSort = (typeof profileBetSortValues)[number];

/** Per-bet outcome from the viewed user's perspective. */
export type ProfileBetResult = 'won' | 'lost' | 'void' | 'pending';

export interface ProfileBetItem {
  id: string;
  shortCode: string;
  title: string;
  status: BetStatus;
  resolveType: ResolveType;
  /** Role the user holds in this bet. */
  role: 'creator' | 'acceptor';
  /** Side label the user took. */
  userSide: string;
  /** User's own locked stake, decimal string. */
  userStakeUsdc: string;
  /** Total pot when fully matched (2 × stake), decimal string. */
  potUsdc: string;
  /** Settlement outcome for the user, or 'pending' if not yet settled. */
  result: ProfileBetResult;
  createdAt: Date;
  expiresAt: Date | null;
  sharePath: string;
}

export interface ListProfileBetsParams {
  filter?: ProfileBetFilter;
  sort?: ProfileBetSort;
  page?: number;
  pageSize?: number;
}

export interface ListProfileBetsResult {
  items: ProfileBetItem[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export const PROFILE_DEFAULT_PAGE_SIZE = 20;
export const PROFILE_MAX_PAGE_SIZE = 100;
