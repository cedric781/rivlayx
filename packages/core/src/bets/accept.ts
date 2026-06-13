import Decimal from 'decimal.js';
import { and, eq, sql } from 'drizzle-orm';
import {
  bets,
  betParticipants,
  betTemplates,
  freezeState,
  users,
  type NewBetParticipant,
} from '@rivlayx/db';
import { BetError } from './errors';
import { recordBetTransition } from './audit';
import { lockStakeForParticipant, recognizeCreationFee } from './escrow';
import type { AcceptBetInput, AcceptBetResult, BetDb } from './types';

/**
 * Accept an OPEN bet, locking the acceptor's stake into escrow and recognising
 * the creator's anti-spam fee to platform revenue. Transitions OPEN → ACTIVE.
 */
export async function acceptBet(db: BetDb, input: AcceptBetInput): Promise<AcceptBetResult> {
  await assertNewBetsNotFrozen(db);

  return db.transaction(async (tx: BetDb) => {
    // SELECT ... FOR UPDATE to guard against concurrent acceptors.
    const rows = await tx.execute(
      sql`SELECT id, creator_user_id, acceptor_user_id, status, version,
                 stake_per_side_usdc, creation_fee_usdc, creator_side,
                 template_id, expires_at
          FROM "app"."bets"
          WHERE id = ${input.betId}
          FOR UPDATE`,
    );
    const row =
      (rows as { rows?: Array<Record<string, unknown>> }).rows?.[0] ??
      (Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined);
    if (!row) throw new BetError('NOT_FOUND', `bet ${input.betId} not found`);

    const status = row['status'] as string;
    if (status !== 'OPEN') {
      throw new BetError('WRONG_STATUS', `bet status is ${status}, not OPEN`);
    }

    const creatorUserId = row['creator_user_id'] as string;
    if (creatorUserId === input.acceptorUserId) {
      throw new BetError('SAME_USER', 'cannot accept your own bet');
    }
    if (row['acceptor_user_id']) {
      throw new BetError('ALREADY_ACCEPTED', 'bet already has an acceptor');
    }

    const expiresAt = row['expires_at'] ? new Date(row['expires_at'] as string) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new BetError('EXPIRED_WINDOW', 'bet open window has already expired');
    }

    // acceptor must be active
    const [acceptor] = await tx
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(eq(users.id, input.acceptorUserId))
      .limit(1);
    if (!acceptor) throw new BetError('NOT_FOUND', 'acceptor not found');
    if (acceptor.status !== 'active') {
      throw new BetError('NOT_AUTHORIZED', `acceptor status is ${acceptor.status}`);
    }

    const stake = new Decimal(row['stake_per_side_usdc'] as string);
    const creationFee = new Decimal(row['creation_fee_usdc'] as string);

    // side validation
    const creatorSide = (row['creator_side'] as string).trim();
    const acceptorSide = input.acceptorSide.trim();
    if (acceptorSide.length === 0 || acceptorSide.length > 64) {
      throw new BetError('INVALID_SIDE', 'acceptor side must be 1..64 chars');
    }
    if (acceptorSide === creatorSide) {
      throw new BetError('INVALID_SIDE', 'acceptor side must differ from creator');
    }
    const templateId = row['template_id'] as string | null;
    if (templateId) {
      const [tmpl] = await tx
        .select({ sidesSchema: betTemplates.sidesSchema })
        .from(betTemplates)
        .where(eq(betTemplates.id, templateId))
        .limit(1);
      if (tmpl?.sidesSchema && Array.isArray(tmpl.sidesSchema)) {
        const allowed = tmpl.sidesSchema as string[];
        if (!allowed.includes(acceptorSide)) {
          throw new BetError(
            'INVALID_SIDE',
            `acceptor side "${acceptorSide}" not in template sides ${JSON.stringify(allowed)}`,
          );
        }
      }
    }

    // balance check
    await assertAcceptorHasBalance(tx, input.acceptorUserId, stake.toFixed(6));

    // ── apply state change + escrow ──────────────────────────────────────
    const updated = await tx
      .update(bets)
      .set({
        acceptorUserId: input.acceptorUserId,
        status: 'ACTIVE',
        activatedAt: new Date(),
        version: sql`${bets.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(bets.id, input.betId), eq(bets.status, 'OPEN')))
      .returning();
    if (updated.length === 0) {
      throw new BetError('WRONG_STATUS', 'bet status moved before update committed');
    }
    const updatedBet = updated[0]!;

    const newParticipant: NewBetParticipant = {
      betId: input.betId,
      userId: input.acceptorUserId,
      role: 'acceptor',
      side: acceptorSide,
      stakeLockedUsdc: stake.toFixed(6),
    };
    const [insertedParticipant] = await tx
      .insert(betParticipants)
      .values(newParticipant)
      .returning();
    if (!insertedParticipant)
      throw new BetError('INVALID_INPUT', 'failed to insert acceptor participant');

    await lockStakeForParticipant(tx, {
      betId: input.betId,
      userId: input.acceptorUserId,
      amountUsdc: stake.toFixed(6),
    });

    if (creationFee.gt(0)) {
      await recognizeCreationFee(tx, {
        betId: input.betId,
        creatorUserId,
        amountUsdc: creationFee.toFixed(6),
      });
    }

    await recordBetTransition(tx, {
      betId: input.betId,
      fromStatus: 'OPEN',
      toStatus: 'ACTIVE',
      eventType: 'bet_accepted',
      actorUserId: input.acceptorUserId,
      actorType: 'user',
      reason: 'acceptor stake locked',
      metadata: { stakeUsdc: stake.toFixed(6) },
    });
    await recordBetTransition(tx, {
      betId: input.betId,
      fromStatus: 'OPEN',
      toStatus: 'ACTIVE',
      eventType: 'bet_activated',
      actorUserId: null,
      actorType: 'system',
      reason: 'both stakes locked',
    });

    return { bet: updatedBet, acceptorParticipant: insertedParticipant };
  });
}

async function assertNewBetsNotFrozen(db: BetDb): Promise<void> {
  const [allRow] = await db
    .select({ frozen: freezeState.frozen })
    .from(freezeState)
    .where(eq(freezeState.component, 'all'))
    .limit(1);
  if (allRow?.frozen) throw new BetError('FROZEN', 'platform frozen (all)');
  const [comp] = await db
    .select({ frozen: freezeState.frozen })
    .from(freezeState)
    .where(eq(freezeState.component, 'new_bets'))
    .limit(1);
  if (comp?.frozen) throw new BetError('FROZEN', 'new_bets frozen');
}

async function assertAcceptorHasBalance(db: BetDb, userId: string, needed: string): Promise<void> {
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
