import { randomUUID } from 'node:crypto';
import { bets, betParticipants, betRules, betShareLinks } from '@rivlayx/db';
import type { BetStatus, BetType, ResolveType, ArbiterType } from '@rivlayx/db';
import { generateShortCode } from '../bets/short-code';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

export interface SeedBetOptions {
  creatorUserId: string;
  acceptorUserId?: string | null;
  status?: BetStatus;
  betType?: BetType;
  templateId?: string | null;
  title?: string;
  description?: string | null;
  resolveType?: ResolveType;
  arbiterType?: ArbiterType;
  resolveSource?: Record<string, unknown>;
  stakePerSideUsdc?: string;
  creatorSide?: string;
  createdAt?: Date;
  expiresAt?: Date | null;
  eventAt?: Date | null;
  /** Engagement on the canonical share link (slug = short code). */
  clicks?: number;
  conversions?: number;
  /** Predicate + display for the single seeded rule. */
  predicate?: Record<string, unknown>;
  ruleDisplay?: string;
}

export interface SeededBet {
  id: string;
  shortCode: string;
}

/**
 * Insert a fully-formed bet (+ rule, creator participant, canonical share link)
 * directly, bypassing the escrow/financial path. Gives marketplace tests exact
 * control over status, stake, timestamps, and share-link engagement.
 */
export async function seedBet(db: AnyDb, opts: SeedBetOptions): Promise<SeededBet> {
  const id = randomUUID();
  const shortCode = generateShortCode();
  const stake = opts.stakePerSideUsdc ?? '10';
  const creatorSide = opts.creatorSide ?? 'home';
  const createdAt = opts.createdAt ?? new Date();

  await db.insert(bets).values({
    id,
    shortCode,
    creatorUserId: opts.creatorUserId,
    acceptorUserId: opts.acceptorUserId ?? null,
    betType: opts.betType ?? 'sports_template',
    templateId: opts.templateId === undefined ? 'football.match_winner' : opts.templateId,
    title: opts.title ?? 'Seeded bet',
    description: opts.description ?? null,
    resolveType: opts.resolveType ?? 'auto',
    resolveSource: opts.resolveSource ?? { provider: 'api_football', externalEventId: '1' },
    arbiterType: opts.arbiterType ?? 'none',
    stakePerSideUsdc: stake,
    settlementFeeBps: 250,
    creatorSide,
    status: opts.status ?? 'OPEN',
    createdAt,
    updatedAt: createdAt,
    expiresAt: opts.expiresAt === undefined ? null : opts.expiresAt,
    eventAt: opts.eventAt ?? null,
  });

  await db.insert(betRules).values({
    betId: id,
    ruleIndex: 0,
    predicate: opts.predicate ?? { type: 'team_wins', team: 'Ajax', eventReference: 'apifootball:fixture:1' },
    display: opts.ruleDisplay ?? 'Ajax wins (event apifootball:fixture:1)',
  });

  await db.insert(betParticipants).values({
    betId: id,
    userId: opts.creatorUserId,
    role: 'creator',
    side: creatorSide,
    stakeLockedUsdc: stake,
  });

  await db.insert(betShareLinks).values({
    betId: id,
    slug: shortCode,
    createdByUserId: opts.creatorUserId,
    clicks: opts.clicks ?? 0,
    conversions: opts.conversions ?? 0,
  });

  return { id, shortCode };
}
