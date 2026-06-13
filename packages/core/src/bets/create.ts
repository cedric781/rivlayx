import Decimal from 'decimal.js';
import { and, eq, sql } from 'drizzle-orm';
import {
  bets,
  betArbiters,
  betParticipants,
  betRules,
  betShareLinks,
  betTemplates,
  freezeState,
  users,
  wallets,
  type NewBet,
  type NewBetArbiter,
  type NewBetParticipant,
  type NewBetRule,
  type NewBetShareLink,
} from '@rivlayx/db';
import { BetError } from './errors';
import { BET_ENGINE_DEFAULTS, type BetEngineConfig } from './config';
import { validateObjectiveBet } from './validation';
import type { PredicateKind } from './validation';
import { generateShortCode } from './short-code';
import { recordBetTransition } from './audit';
import { lockCreationFee, lockStakeForParticipant } from './escrow';
import type { BetDb, CreateBetInput, CreateBetResult } from './types';

const PREDICATE_KIND_VALUES = [
  'team_wins',
  'score_over_under',
  'price_above',
  'price_below',
  'event_occurs_before',
  'distance_completed',
] as const;

function isPredicateKind(value: string): value is PredicateKind {
  return (PREDICATE_KIND_VALUES as readonly string[]).includes(value);
}

/**
 * Create a bet and move it to OPEN. Atomic — bet rows, participant, audit log,
 * and the creator's escrow + creation-fee lock all commit together.
 */
export async function createBet(
  db: BetDb,
  input: CreateBetInput,
  config: BetEngineConfig = BET_ENGINE_DEFAULTS,
): Promise<CreateBetResult> {
  await assertNewBetsNotFrozen(db);

  // ── creator must be active ──────────────────────────────────────────────
  const [creator] = await db
    .select({ id: users.id, status: users.status })
    .from(users)
    .where(eq(users.id, input.creatorUserId))
    .limit(1);
  if (!creator) {
    throw new BetError('NOT_FOUND', `Creator not found: ${input.creatorUserId}`);
  }
  if (creator.status !== 'active') {
    throw new BetError('NOT_AUTHORIZED', `Creator status is ${creator.status}`);
  }

  // ── stake bounds + amount sanity ────────────────────────────────────────
  const stake = new Decimal(input.stakePerSideUsdc);
  if (!stake.isFinite() || stake.lte(0)) {
    throw new BetError('INVALID_INPUT', 'stake must be > 0');
  }
  const maxBet = new Decimal(config.maxBetUsdc);
  if (stake.gt(maxBet)) {
    throw new BetError(
      'STAKE_TOO_LARGE',
      `stake ${stake.toFixed(6)} exceeds cap ${maxBet.toFixed(6)}`,
    );
  }

  const creationFee = new Decimal(input.creationFeeUsdc ?? config.defaultCreationFeeUsdc);
  if (!creationFee.isFinite() || creationFee.lt(0)) {
    throw new BetError('INVALID_INPUT', 'creation fee must be >= 0');
  }

  const settlementFeeBps = input.settlementFeeBps ?? config.defaultSettlementFeeBps;
  if (!Number.isInteger(settlementFeeBps) || settlementFeeBps < 0 || settlementFeeBps > 10_000) {
    throw new BetError('INVALID_INPUT', 'settlement fee bps must be 0..10000');
  }

  // ── expires_at window ───────────────────────────────────────────────────
  const expiresAt = parseIso(input.expiresAt, 'expiresAt');
  const now = Date.now();
  const minOpenMs = config.minOpenMinutes * 60_000;
  const maxOpenMs = config.maxOpenDays * 86_400_000;
  if (expiresAt.getTime() - now < minOpenMs) {
    throw new BetError(
      'INVALID_EXPIRES_AT',
      `expiresAt must be at least ${config.minOpenMinutes} min in the future`,
    );
  }
  if (expiresAt.getTime() - now > maxOpenMs) {
    throw new BetError(
      'INVALID_EXPIRES_AT',
      `expiresAt must be at most ${config.maxOpenDays} days in the future`,
    );
  }

  // ── template binding (if any) ───────────────────────────────────────────
  let templateRow: {
    id: string;
    predicateKind: string;
    sidesSchema: unknown;
    active: boolean;
  } | null = null;
  if (input.betType === 'sports_template') {
    if (!input.templateId) {
      throw new BetError('INVALID_INPUT', 'sports_template bet requires templateId');
    }
    const [t] = await db
      .select({
        id: betTemplates.id,
        predicateKind: betTemplates.predicateKind,
        sidesSchema: betTemplates.sidesSchema,
        active: betTemplates.active,
      })
      .from(betTemplates)
      .where(eq(betTemplates.id, input.templateId))
      .limit(1);
    if (!t) throw new BetError('TEMPLATE_NOT_FOUND', `template ${input.templateId} not found`);
    if (!t.active)
      throw new BetError('TEMPLATE_INACTIVE', `template ${input.templateId} is inactive`);
    if (!isPredicateKind(t.predicateKind)) {
      throw new BetError(
        'TEMPLATE_NOT_FOUND',
        `template uses unknown predicate kind ${t.predicateKind}`,
      );
    }
    templateRow = t;
  } else if (input.templateId) {
    throw new BetError('INVALID_INPUT', 'open_objective bets must not reference a templateId');
  }

  // ── objective validation (title, predicate, predicate↔template) ─────────
  const validated = validateObjectiveBet({
    title: input.title,
    description: input.description ?? null,
    predicate: input.predicate,
    expectedPredicateKind: templateRow ? (templateRow.predicateKind as PredicateKind) : undefined,
  });

  // ── creator side validation ─────────────────────────────────────────────
  const creatorSide = input.creatorSide.trim();
  if (creatorSide.length === 0 || creatorSide.length > 64) {
    throw new BetError('INVALID_SIDE', 'creator side must be 1..64 chars');
  }
  if (templateRow?.sidesSchema && Array.isArray(templateRow.sidesSchema)) {
    const allowed = templateRow.sidesSchema as string[];
    if (!allowed.includes(creatorSide)) {
      throw new BetError(
        'INVALID_SIDE',
        `creator side "${creatorSide}" not in template sides ${JSON.stringify(allowed)}`,
      );
    }
  }

  // ── resolve config sanity ───────────────────────────────────────────────
  if (input.resolveType === 'auto') {
    if (!input.resolveSource.provider || !input.resolveSource.externalEventId) {
      throw new BetError(
        'INVALID_RESOLVE_CONFIG',
        'auto-resolve bets need provider + externalEventId',
      );
    }
  } else if (input.resolveType === 'evidence') {
    if (!input.evidenceDeadline) {
      throw new BetError('INVALID_RESOLVE_CONFIG', 'evidence-resolve bets need evidenceDeadline');
    }
  } else if (input.resolveType === 'arbiter') {
    if (input.arbiterType === 'none') {
      throw new BetError('INVALID_ARBITER', 'arbiter-resolve bets need arbiterType != none');
    }
  }

  // ── arbiter binding (when applicable) ───────────────────────────────────
  if (input.arbiterType === 'user_selected') {
    if (!input.arbiterUserId) {
      throw new BetError('INVALID_ARBITER', 'user_selected arbiter requires arbiterUserId');
    }
    if (input.arbiterUserId === input.creatorUserId) {
      throw new BetError('INVALID_ARBITER', 'arbiter cannot be the creator');
    }
    const [arb] = await db
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(eq(users.id, input.arbiterUserId))
      .limit(1);
    if (!arb || arb.status !== 'active') {
      throw new BetError('INVALID_ARBITER', `arbiter ${input.arbiterUserId} not found or inactive`);
    }
  } else if (input.arbiterType === 'platform_selected') {
    if (input.arbiterUserId) {
      throw new BetError(
        'INVALID_ARBITER',
        'platform_selected arbiter must not pre-bind arbiterUserId',
      );
    }
  }
  // arbiter_type='none' → no further check

  // ── balance check ───────────────────────────────────────────────────────
  await assertCreatorHasBalance(db, input.creatorUserId, stake.add(creationFee).toFixed(6));

  // ── creator must have a primary wallet linked ───────────────────────────
  const [primaryWallet] = await db
    .select({ address: wallets.address })
    .from(wallets)
    .where(and(eq(wallets.userId, input.creatorUserId), eq(wallets.isPrimary, true)))
    .limit(1);
  if (!primaryWallet) {
    throw new BetError('NOT_AUTHORIZED', 'creator must have a linked Solana wallet');
  }

  const shortCode = generateShortCode();
  const eventAt = input.eventAt ? parseIso(input.eventAt, 'eventAt') : null;
  const evidenceDeadline = input.evidenceDeadline
    ? parseIso(input.evidenceDeadline, 'evidenceDeadline')
    : null;

  return db.transaction(async (tx: BetDb) => {
    const newBet: NewBet = {
      shortCode,
      creatorUserId: input.creatorUserId,
      betType: input.betType,
      templateId: input.templateId ?? null,
      title: validated.title,
      description: validated.description,
      resolveType: input.resolveType,
      resolveSource: input.resolveSource,
      arbiterType: input.arbiterType,
      stakePerSideUsdc: stake.toFixed(6),
      creationFeeUsdc: creationFee.toFixed(6),
      settlementFeeBps,
      creatorSide,
      status: 'OPEN',
      expiresAt,
      eventAt,
      evidenceDeadline,
      openedAt: new Date(),
    };
    const [insertedBet] = await tx.insert(bets).values(newBet).returning();
    if (!insertedBet) throw new BetError('INVALID_INPUT', 'failed to insert bet');
    const betId = insertedBet.id;

    const newRule: NewBetRule = {
      betId,
      ruleIndex: 0,
      predicate: validated.predicate,
      display: validated.display,
    };
    const [insertedRule] = await tx.insert(betRules).values(newRule).returning();
    if (!insertedRule) throw new BetError('INVALID_INPUT', 'failed to insert bet rule');

    if (input.arbiterType !== 'none' && input.arbiterUserId) {
      const newArbiter: NewBetArbiter = {
        betId,
        arbiterUserId: input.arbiterUserId,
        selectedBy: input.arbiterType === 'user_selected' ? 'creator' : 'platform',
        status: 'pending',
      };
      await tx.insert(betArbiters).values(newArbiter);
    }

    const newParticipant: NewBetParticipant = {
      betId,
      userId: input.creatorUserId,
      role: 'creator',
      side: creatorSide,
      stakeLockedUsdc: stake.toFixed(6),
    };
    const [insertedParticipant] = await tx
      .insert(betParticipants)
      .values(newParticipant)
      .returning();
    if (!insertedParticipant) throw new BetError('INVALID_INPUT', 'failed to insert participant');

    await lockStakeForParticipant(tx, {
      betId,
      userId: input.creatorUserId,
      amountUsdc: stake.toFixed(6),
    });

    if (creationFee.gt(0)) {
      await lockCreationFee(tx, {
        betId,
        creatorUserId: input.creatorUserId,
        amountUsdc: creationFee.toFixed(6),
      });
    }

    const shareLink: NewBetShareLink = {
      betId,
      slug: shortCode,
      createdByUserId: input.creatorUserId,
    };
    await tx.insert(betShareLinks).values(shareLink);

    await recordBetTransition(tx, {
      betId,
      fromStatus: null,
      toStatus: 'OPEN',
      eventType: 'bet_created',
      actorUserId: input.creatorUserId,
      actorType: 'user',
      reason: 'bet created',
      metadata: { shortCode, stakeUsdc: stake.toFixed(6) },
    });
    await recordBetTransition(tx, {
      betId,
      fromStatus: 'DRAFT',
      toStatus: 'OPEN',
      eventType: 'bet_opened',
      actorUserId: input.creatorUserId,
      actorType: 'system',
      reason: 'creator stake locked',
    });

    return {
      bet: insertedBet,
      rule: insertedRule,
      creatorParticipant: insertedParticipant,
      shareSlug: shortCode,
    };
  });
}

async function assertNewBetsNotFrozen(db: BetDb): Promise<void> {
  const [allRow] = await db
    .select({ frozen: freezeState.frozen })
    .from(freezeState)
    .where(eq(freezeState.component, 'all'))
    .limit(1);
  if (allRow?.frozen) {
    throw new BetError('FROZEN', 'platform frozen (all)');
  }
  const [comp] = await db
    .select({ frozen: freezeState.frozen })
    .from(freezeState)
    .where(eq(freezeState.component, 'new_bets'))
    .limit(1);
  if (comp?.frozen) {
    throw new BetError('FROZEN', 'new_bets frozen');
  }
}

async function assertCreatorHasBalance(db: BetDb, userId: string, needed: string): Promise<void> {
  const [row] = await db
    .select({
      availableUsdc: sql<string>`COALESCE("financial"."balances"."available_usdc", '0')`,
    })
    .from(sql`"financial"."balances"`)
    .where(sql`"financial"."balances"."user_id" = ${userId}`)
    .limit(1);
  const available = new Decimal(row?.availableUsdc ?? '0');
  if (available.lt(new Decimal(needed))) {
    throw new BetError(
      'INSUFFICIENT_BALANCE',
      `needed ${needed}, available ${available.toFixed(6)}`,
    );
  }
}

function parseIso(value: string, field: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new BetError('INVALID_INPUT', `${field} is not a valid ISO datetime: ${value}`);
  }
  return d;
}
