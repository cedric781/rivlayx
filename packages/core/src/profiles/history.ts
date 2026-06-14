import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import { bets, betParticipants, settlements } from '@rivlayx/db';
import { potUsdc } from '../marketplace/query';
import {
  PROFILE_DEFAULT_PAGE_SIZE,
  PROFILE_MAX_PAGE_SIZE,
  type ListProfileBetsParams,
  type ListProfileBetsResult,
  type ProfileBetItem,
  type ProfileBetResult,
} from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ProfilesDb = any;

/** Build the filter-specific WHERE condition (always scoped to the user). */
function filterCondition(userId: string, filter: ListProfileBetsParams['filter']): SQL {
  const base = eq(betParticipants.userId, userId);
  switch (filter) {
    case 'open':
      return and(base, eq(bets.status, 'OPEN'))!;
    case 'active':
      return and(base, eq(bets.status, 'ACTIVE'))!;
    case 'awaiting':
      return and(base, eq(bets.status, 'AWAITING_RESULT'))!;
    case 'disputed':
      return and(base, eq(bets.status, 'DISPUTED'))!;
    case 'won':
      return and(base, eq(settlements.winnerUserId, userId))!;
    case 'lost':
      return and(base, eq(settlements.loserUserId, userId))!;
    case 'all':
    default:
      return base;
  }
}

function orderClause(sort: ListProfileBetsParams['sort']): SQL[] {
  switch (sort) {
    case 'oldest':
      return [asc(bets.createdAt), asc(bets.id)];
    case 'highest_stake':
      return [desc(bets.stakePerSideUsdc), desc(bets.id)];
    case 'highest_pot':
      // pot = 2 × stake, so it orders identically to stake.
      return [desc(bets.stakePerSideUsdc), desc(bets.id)];
    case 'newest':
    default:
      return [desc(bets.createdAt), desc(bets.id)];
  }
}

function outcomeFor(
  userId: string,
  status: string,
  winnerUserId: string | null,
  loserUserId: string | null,
  settlementKind: string | null,
): ProfileBetResult {
  if (winnerUserId === userId) return 'won';
  if (loserUserId === userId) return 'lost';
  if (status === 'VOID' || settlementKind === 'draw_refund') return 'void';
  return 'pending';
}

/**
 * Paginated bet history for a user, filterable by lifecycle bucket and
 * sortable by recency / stake / pot. Each item carries the user's own role,
 * side, stake and the settled outcome from their perspective.
 */
export async function listProfileBets(
  db: ProfilesDb,
  userId: string,
  params: ListProfileBetsParams = {},
): Promise<ListProfileBetsResult> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(
    PROFILE_MAX_PAGE_SIZE,
    Math.max(1, params.pageSize ?? PROFILE_DEFAULT_PAGE_SIZE),
  );
  const where = filterCondition(userId, params.filter);

  const [countRow] = await db
    .select({ total: sql<number>`count(*)` })
    .from(betParticipants)
    .innerJoin(bets, eq(bets.id, betParticipants.betId))
    .leftJoin(settlements, eq(settlements.betId, bets.id))
    .where(where);
  const total = Number(countRow?.total ?? 0);

  const rows = await db
    .select({
      id: bets.id,
      shortCode: bets.shortCode,
      title: bets.title,
      status: bets.status,
      resolveType: bets.resolveType,
      role: betParticipants.role,
      userSide: betParticipants.side,
      userStakeUsdc: betParticipants.stakeLockedUsdc,
      stakePerSideUsdc: bets.stakePerSideUsdc,
      createdAt: bets.createdAt,
      expiresAt: bets.expiresAt,
      winnerUserId: settlements.winnerUserId,
      loserUserId: settlements.loserUserId,
      settlementKind: settlements.kind,
    })
    .from(betParticipants)
    .innerJoin(bets, eq(bets.id, betParticipants.betId))
    .leftJoin(settlements, eq(settlements.betId, bets.id))
    .where(where)
    .orderBy(...orderClause(params.sort))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const items: ProfileBetItem[] = rows.map(
    (r: {
      id: string;
      shortCode: string;
      title: string;
      status: ProfileBetItem['status'];
      resolveType: ProfileBetItem['resolveType'];
      role: ProfileBetItem['role'];
      userSide: string;
      userStakeUsdc: string;
      stakePerSideUsdc: string;
      createdAt: Date;
      expiresAt: Date | null;
      winnerUserId: string | null;
      loserUserId: string | null;
      settlementKind: string | null;
    }) => ({
      id: r.id,
      shortCode: r.shortCode,
      title: r.title,
      status: r.status,
      resolveType: r.resolveType,
      role: r.role,
      userSide: r.userSide,
      userStakeUsdc: r.userStakeUsdc,
      potUsdc: potUsdc(r.stakePerSideUsdc),
      result: outcomeFor(userId, r.status, r.winnerUserId, r.loserUserId, r.settlementKind),
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      sharePath: `/b/${r.shortCode}`,
    }),
  );

  return { items, page, pageSize, total, hasMore: page * pageSize < total };
}
