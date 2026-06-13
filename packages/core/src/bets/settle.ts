import { randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { and, eq, sql } from 'drizzle-orm';
import { bets, betEvents, settlements, type Bet, type Settlement } from '@rivlayx/db';
import { BetError } from './errors';
import { recordBetTransition } from './audit';
import { postLedgerTxnIn } from '../ledger/post';
import type { BetDb } from './types';
import type { LedgerEntryInput } from '../ledger/types';

/**
 * Settle a RESOLVED bet — Sprint 10.
 *
 * Flow (single transaction, FOR UPDATE on the bet row):
 *   1. RESOLVED → SETTLING (audit transition)
 *   2. Compute pot (2 × stake), fee (pot × bps / 10000), net (pot − fee)
 *   3. Move escrow to winner.available + platform_fee via one ledger txn
 *   4. INSERT settlements row (UNIQUE(bet_id) is the double-settle guard)
 *   5. SETTLING → SETTLED (audit transition + settled_at)
 *   6. Emit bet_events: bet_settled, bet_win, bet_loss, platform_fee
 *
 * Two outcomes:
 *   - kind='winner_payout': resolved_winner_user_id set; winner takes net,
 *     platform takes fee.
 *   - kind='draw_refund':   resolved_winner_user_id NULL; both refunded
 *     their stake, no fee taken.
 *
 * Idempotency layers:
 *   1. Early-exit on bets.status='SETTLED' returns the existing settlement.
 *   2. Transactional rollback on any failure mid-flight (RESOLVED→SETTLING
 *      lock + ledger post + settlement insert all share one tx).
 *   3. UNIQUE(settlements.bet_id) is the database-level final guard.
 *
 * Out of scope: withdrawals, Solana transactions, payout execution. The
 * winner's net sits in `user_available` and is withdrawn in a later sprint.
 */
export interface SettleBetInput {
  betId: string;
  /** Optional admin actor for the audit trail. Defaults to 'system' actor. */
  actorUserId?: string | null;
  reason?: string;
}

export type SettleBetResult =
  | { kind: 'settled'; settlement: Settlement; bet: Bet }
  | { kind: 'already_settled'; settlement: Settlement; bet: Bet };

export async function settleBet(db: BetDb, input: SettleBetInput): Promise<SettleBetResult> {
  return db.transaction(async (tx: BetDb) => {
    const row = await selectBetForUpdate(tx, input.betId);
    if (!row) throw new BetError('NOT_FOUND', `bet ${input.betId} not found`);
    const status = row['status'] as string;

    // Idempotent return for already-settled bets.
    if (status === 'SETTLED' || status === 'SETTLING') {
      const existing = await tx
        .select()
        .from(settlements)
        .where(eq(settlements.betId, input.betId))
        .limit(1);
      if (existing[0]) {
        const [betRow] = await tx.select().from(bets).where(eq(bets.id, input.betId)).limit(1);
        return { kind: 'already_settled', settlement: existing[0], bet: betRow! };
      }
      // SETTLING without a settlement row would be an invariant break — fall
      // through to throw below for a clean error.
    }

    if (status !== 'RESOLVED') {
      throw new BetError('WRONG_STATUS', `settleBet requires RESOLVED, got ${status}`);
    }

    const creatorUserId = row['creator_user_id'] as string;
    const acceptorUserId = row['acceptor_user_id'] as string | null;
    if (!acceptorUserId) {
      throw new BetError('INVALID_INPUT', 'cannot settle a bet without an acceptor');
    }
    const resolvedWinner = row['resolved_winner_user_id'] as string | null;

    const stake = new Decimal(row['stake_per_side_usdc'] as string);
    const feeBps = Number(row['settlement_fee_bps']);
    const pot = stake.mul(2);

    // ── 1. RESOLVED → SETTLING ───────────────────────────────────────
    const settlingUpdate = await tx
      .update(bets)
      .set({
        status: 'SETTLING',
        version: sql`${bets.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(bets.id, input.betId), eq(bets.status, 'RESOLVED')))
      .returning();
    if (settlingUpdate.length === 0) {
      throw new BetError('WRONG_STATUS', 'bet status moved before settle started');
    }

    await recordBetTransition(tx, {
      betId: input.betId,
      fromStatus: 'RESOLVED',
      toStatus: 'SETTLING',
      eventType: 'bet_settling',
      actorUserId: input.actorUserId ?? null,
      actorType: input.actorUserId ? 'admin' : 'system',
      reason: input.reason ?? 'settlement started',
    });

    // ── 2 + 3. Compute amounts + post ledger ─────────────────────────
    const ledgerTxnId = randomUUID();
    const ledgerRequestId = randomUUID();
    const settledAt = new Date();

    let kind: 'winner_payout' | 'draw_refund';
    let potString: string;
    let grossWinnerString: string;
    let platformFeeString: string;
    let netWinnerString: string;
    let winnerUserId: string | null;
    let loserUserId: string | null;

    if (resolvedWinner) {
      // Winner-pays-out path.
      if (resolvedWinner !== creatorUserId && resolvedWinner !== acceptorUserId) {
        throw new BetError('INVALID_INPUT', 'resolved_winner_user_id must be creator or acceptor');
      }
      kind = 'winner_payout';
      winnerUserId = resolvedWinner;
      loserUserId = resolvedWinner === creatorUserId ? acceptorUserId : creatorUserId;

      const platformFee = pot.mul(feeBps).div(10000);
      const netWinner = pot.sub(platformFee);

      potString = pot.toFixed(6);
      grossWinnerString = pot.toFixed(6);
      platformFeeString = platformFee.toFixed(6);
      netWinnerString = netWinner.toFixed(6);

      const stakeStr = stake.toFixed(6);
      const entries: LedgerEntryInput[] = [
        // Release winner's lock (escrow → 0)
        {
          accountType: 'bet_escrow',
          accountRef: input.betId,
          direction: 'debit',
          amountUsdc: stakeStr,
          reason: 'settlement_payout',
          betId: input.betId,
          affectsUserId: winnerUserId,
        },
        // Release loser's lock (escrow → 0)
        {
          accountType: 'bet_escrow',
          accountRef: input.betId,
          direction: 'debit',
          amountUsdc: stakeStr,
          reason: 'settlement_payout',
          betId: input.betId,
          affectsUserId: loserUserId,
        },
        // Credit winner's available with net payout
        {
          accountType: 'user_available',
          accountRef: winnerUserId,
          direction: 'credit',
          amountUsdc: netWinnerString,
          reason: 'settlement_payout',
          betId: input.betId,
        },
        // Recognize platform fee
        {
          accountType: 'platform_fee',
          accountRef: 'platform',
          direction: 'credit',
          amountUsdc: platformFeeString,
          reason: 'settlement_fee',
          betId: input.betId,
        },
      ];

      await postLedgerTxnIn(tx, {
        txnId: ledgerTxnId,
        requestId: ledgerRequestId,
        createdBy: 'settlement-engine:winner_payout',
        entries,
      });
    } else {
      // Draw — refund both stakes, no fee.
      kind = 'draw_refund';
      winnerUserId = null;
      loserUserId = null;

      potString = pot.toFixed(6);
      grossWinnerString = stake.toFixed(6); // each side's own refund
      platformFeeString = '0.000000';
      netWinnerString = stake.toFixed(6);

      const stakeStr = stake.toFixed(6);
      const entries: LedgerEntryInput[] = [
        {
          accountType: 'bet_escrow',
          accountRef: input.betId,
          direction: 'debit',
          amountUsdc: stakeStr,
          reason: 'stake_unlock_refund',
          betId: input.betId,
          affectsUserId: creatorUserId,
        },
        {
          accountType: 'user_available',
          accountRef: creatorUserId,
          direction: 'credit',
          amountUsdc: stakeStr,
          reason: 'stake_unlock_refund',
          betId: input.betId,
        },
        {
          accountType: 'bet_escrow',
          accountRef: input.betId,
          direction: 'debit',
          amountUsdc: stakeStr,
          reason: 'stake_unlock_refund',
          betId: input.betId,
          affectsUserId: acceptorUserId,
        },
        {
          accountType: 'user_available',
          accountRef: acceptorUserId,
          direction: 'credit',
          amountUsdc: stakeStr,
          reason: 'stake_unlock_refund',
          betId: input.betId,
        },
      ];

      await postLedgerTxnIn(tx, {
        txnId: ledgerTxnId,
        requestId: ledgerRequestId,
        createdBy: 'settlement-engine:draw_refund',
        entries,
      });
    }

    // ── 4. INSERT settlement record ──────────────────────────────────
    const [settlement] = await tx
      .insert(settlements)
      .values({
        betId: input.betId,
        kind,
        winnerUserId,
        loserUserId,
        potUsdc: potString,
        grossWinnerUsdc: grossWinnerString,
        platformFeeUsdc: platformFeeString,
        netWinnerUsdc: netWinnerString,
        ledgerTxnId,
        settledAt,
      })
      .returning();
    if (!settlement) {
      throw new BetError('INVALID_INPUT', 'settlement insert returned no row');
    }

    // ── 5. SETTLING → SETTLED ────────────────────────────────────────
    const settledUpdate = await tx
      .update(bets)
      .set({
        status: 'SETTLED',
        settledAt,
        version: sql`${bets.version} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(bets.id, input.betId), eq(bets.status, 'SETTLING')))
      .returning();
    if (settledUpdate.length === 0) {
      throw new BetError('WRONG_STATUS', 'bet status moved before settle finalised');
    }

    await recordBetTransition(tx, {
      betId: input.betId,
      fromStatus: 'SETTLING',
      toStatus: 'SETTLED',
      eventType: 'bet_settled',
      actorUserId: input.actorUserId ?? null,
      actorType: input.actorUserId ? 'admin' : 'system',
      reason: input.reason ?? 'settlement complete',
      metadata: {
        settlementId: settlement.id,
        kind,
        potUsdc: potString,
        platformFeeUsdc: platformFeeString,
        netWinnerUsdc: netWinnerString,
      },
    });

    // ── 6. Granular event-feed entries ───────────────────────────────
    if (kind === 'winner_payout') {
      await tx.insert(betEvents).values([
        {
          betId: input.betId,
          eventType: 'bet_win',
          actorUserId: winnerUserId,
          payload: { amountUsdc: netWinnerString, settlementId: settlement.id },
        },
        {
          betId: input.betId,
          eventType: 'bet_loss',
          actorUserId: loserUserId,
          payload: { amountUsdc: stake.toFixed(6), settlementId: settlement.id },
        },
        {
          betId: input.betId,
          eventType: 'platform_fee',
          actorUserId: null,
          payload: { amountUsdc: platformFeeString, settlementId: settlement.id },
        },
      ]);
    }
    // Draw path emits no bet_win/bet_loss/platform_fee — bet_settled covers it.

    return { kind: 'settled', settlement, bet: settledUpdate[0]! };
  });
}

/**
 * SELECT ... FOR UPDATE on a bet row. Snake-case keys, matches the helper in
 * resolve.ts.
 */
async function selectBetForUpdate(
  tx: BetDb,
  betId: string,
): Promise<Record<string, unknown> | null> {
  const rows = await tx.execute(
    sql`SELECT id, creator_user_id, acceptor_user_id, status, version,
               stake_per_side_usdc, settlement_fee_bps,
               resolved_winner_user_id, settled_at
        FROM "app"."bets"
        WHERE id = ${betId}
        FOR UPDATE`,
  );
  const row =
    (rows as { rows?: Array<Record<string, unknown>> }).rows?.[0] ??
    (Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined);
  return row ?? null;
}
