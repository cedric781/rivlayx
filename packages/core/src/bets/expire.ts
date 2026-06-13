import Decimal from 'decimal.js';
import { and, eq, sql } from 'drizzle-orm';
import { bets } from '@rivlayx/db';
import { BetError } from './errors';
import { recordBetTransition } from './audit';
import { refundCreationFee, refundStakeToParticipant } from './escrow';
import type { BetDb, ExpireBetInput, ExpireBetResult } from './types';

/**
 * Move an OPEN bet whose `expires_at` is in the past to EXPIRED, refunding
 * the creator's stake + creation fee back to their available balance.
 *
 *   - Idempotent: re-running for a non-OPEN bet returns `not_expirable`.
 *   - Only OPEN bets are expirable. ACTIVE / RESOLVED bets follow their own
 *     life cycle.
 *   - When `actorUserId` is omitted the actor is logged as `system` (cron).
 */
export async function expireBet(db: BetDb, input: ExpireBetInput): Promise<ExpireBetResult> {
  return db.transaction(async (tx: BetDb) => {
    const rows = await tx.execute(
      sql`SELECT id, creator_user_id, status, stake_per_side_usdc,
                 creation_fee_usdc, expires_at
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
      return { kind: 'not_expirable', reason: `status is ${status}` };
    }
    const expiresAt = row['expires_at'] ? new Date(row['expires_at'] as string) : null;
    if (!expiresAt || expiresAt.getTime() > Date.now()) {
      return { kind: 'not_expirable', reason: 'expiry not yet reached' };
    }

    const creatorUserId = row['creator_user_id'] as string;
    const stake = new Decimal(row['stake_per_side_usdc'] as string);
    const creationFee = new Decimal(row['creation_fee_usdc'] as string);

    const updated = await tx
      .update(bets)
      .set({
        status: 'EXPIRED',
        expiredAt: new Date(),
        version: sql`${bets.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(bets.id, input.betId), eq(bets.status, 'OPEN')))
      .returning();
    if (updated.length === 0) {
      // someone else expired/accepted in the meantime
      return { kind: 'not_expirable', reason: 'concurrent state change' };
    }
    const updatedBet = updated[0]!;

    await refundStakeToParticipant(tx, {
      betId: input.betId,
      userId: creatorUserId,
      amountUsdc: stake.toFixed(6),
    });
    if (creationFee.gt(0)) {
      await refundCreationFee(tx, {
        betId: input.betId,
        creatorUserId,
        amountUsdc: creationFee.toFixed(6),
      });
    }

    await recordBetTransition(tx, {
      betId: input.betId,
      fromStatus: 'OPEN',
      toStatus: 'EXPIRED',
      eventType: 'bet_expired',
      actorUserId: input.actorUserId ?? null,
      actorType: input.actorUserId ? 'admin' : 'system',
      reason: 'open window elapsed; stake + fee refunded',
    });

    return { kind: 'expired', bet: updatedBet };
  });
}
