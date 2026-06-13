import Decimal from 'decimal.js';
import { and, eq, sql } from 'drizzle-orm';
import { bets } from '@rivlayx/db';
import { BetError } from './errors';
import { recordBetTransition } from './audit';
import { refundCreationFee, refundStakeToParticipant } from './escrow';
import type { BetDb, CancelBetInput, CancelBetResult } from './types';

/**
 * Creator-only cancel of an OPEN bet that has not yet been accepted.
 * Refunds stake + creation fee. Once the bet is ACTIVE, cancellation is not
 * available — disputes/void must be used (Sprint 7+).
 */
export async function cancelBet(db: BetDb, input: CancelBetInput): Promise<CancelBetResult> {
  return db.transaction(async (tx: BetDb) => {
    const rows = await tx.execute(
      sql`SELECT id, creator_user_id, acceptor_user_id, status,
                 stake_per_side_usdc, creation_fee_usdc
          FROM "app"."bets"
          WHERE id = ${input.betId}
          FOR UPDATE`,
    );
    const row =
      (rows as { rows?: Array<Record<string, unknown>> }).rows?.[0] ??
      (Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined);
    if (!row) throw new BetError('NOT_FOUND', `bet ${input.betId} not found`);

    if ((row['creator_user_id'] as string) !== input.actorUserId) {
      throw new BetError('NOT_AUTHORIZED', 'only the creator may cancel');
    }

    const status = row['status'] as string;
    if (status !== 'OPEN') {
      throw new BetError('WRONG_STATUS', `cannot cancel from status ${status}`);
    }
    if (row['acceptor_user_id']) {
      // Defensive: OPEN should imply no acceptor, but guard anyway.
      throw new BetError('WRONG_STATUS', 'cannot cancel after acceptance');
    }

    const stake = new Decimal(row['stake_per_side_usdc'] as string);
    const creationFee = new Decimal(row['creation_fee_usdc'] as string);

    const updated = await tx
      .update(bets)
      .set({
        status: 'CANCELLED',
        cancelledAt: new Date(),
        version: sql`${bets.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(bets.id, input.betId), eq(bets.status, 'OPEN')))
      .returning();
    if (updated.length === 0) {
      throw new BetError('WRONG_STATUS', 'bet status moved before update committed');
    }
    const updatedBet = updated[0]!;

    await refundStakeToParticipant(tx, {
      betId: input.betId,
      userId: row['creator_user_id'] as string,
      amountUsdc: stake.toFixed(6),
    });
    if (creationFee.gt(0)) {
      await refundCreationFee(tx, {
        betId: input.betId,
        creatorUserId: row['creator_user_id'] as string,
        amountUsdc: creationFee.toFixed(6),
      });
    }

    await recordBetTransition(tx, {
      betId: input.betId,
      fromStatus: 'OPEN',
      toStatus: 'CANCELLED',
      eventType: 'bet_cancelled',
      actorUserId: input.actorUserId,
      actorType: 'user',
      reason: input.reason ?? 'creator cancelled',
    });

    return { bet: updatedBet };
  });
}
