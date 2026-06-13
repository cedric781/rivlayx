import { and, eq } from 'drizzle-orm';
import { bets, payouts, settlements, wallets, type Payout } from '@rivlayx/db';
import { PayoutError } from './errors';
import { validatePayoutAmount } from './cap';
import type { LedgerDb } from '../ledger/types';

export interface QueuePayoutsResult {
  /** Newly inserted payout rows for this settlement. */
  inserted: Payout[];
  /** Existing payout rows that were already queued (idempotent return). */
  existing: Payout[];
}

/**
 * Insert one or more `payouts` rows for a SETTLED bet:
 *
 *   - `winner_payout` settlements → one row for the winner with the net amount
 *   - `draw_refund`   settlements → one row per participant with their stake
 *
 * Idempotent on UNIQUE(settlement_id, user_id). Safe to call from a
 * post-settle hook AND from the runner's catch-up pass.
 *
 * Validates the cap (PAYOUT_LIMITS.maxPayoutUsdc) up-front so an oversize
 * settlement never enters the queue at all.
 */
export async function queuePayoutsForSettlement(
  db: LedgerDb,
  input: { settlementId: string },
): Promise<QueuePayoutsResult> {
  const [settlement] = await db
    .select()
    .from(settlements)
    .where(eq(settlements.id, input.settlementId))
    .limit(1);
  if (!settlement) {
    throw new PayoutError('NOT_FOUND', `settlement ${input.settlementId} not found`);
  }

  const [bet] = await db.select().from(bets).where(eq(bets.id, settlement.betId)).limit(1);
  if (!bet) throw new PayoutError('NOT_FOUND', `bet ${settlement.betId} not found`);

  type Candidate = { userId: string; amount: string };
  const candidates: Candidate[] = [];

  if (settlement.kind === 'winner_payout') {
    if (!settlement.winnerUserId) {
      throw new PayoutError('INVALID_INPUT', 'winner_payout settlement missing winner_user_id');
    }
    candidates.push({
      userId: settlement.winnerUserId,
      amount: settlement.netWinnerUsdc,
    });
  } else {
    // draw_refund — both sides refunded their stake
    const stake = settlement.netWinnerUsdc; // per side
    if (!bet.acceptorUserId) {
      throw new PayoutError('INVALID_INPUT', 'draw_refund settlement missing acceptor');
    }
    candidates.push({ userId: bet.creatorUserId, amount: stake });
    candidates.push({ userId: bet.acceptorUserId, amount: stake });
  }

  for (const c of candidates) {
    validatePayoutAmount(c.amount);
  }

  const inserted: Payout[] = [];
  const existing: Payout[] = [];

  for (const c of candidates) {
    const wallet = await primaryWalletFor(db, c.userId);
    if (!wallet) {
      throw new PayoutError('NO_PRIMARY_WALLET', `user ${c.userId} has no primary Solana wallet`);
    }
    const rows = await db
      .insert(payouts)
      .values({
        betId: settlement.betId,
        settlementId: settlement.id,
        userId: c.userId,
        amountUsdc: c.amount,
        destinationWallet: wallet,
        // status defaults to 'pending', attempts=0, next_attempt_at=now
      })
      .onConflictDoNothing({ target: [payouts.settlementId, payouts.userId] })
      .returning();
    if (rows[0]) {
      inserted.push(rows[0]);
    } else {
      // Fetch the existing row so callers can see what's there.
      const [old] = await db
        .select()
        .from(payouts)
        .where(and(eq(payouts.settlementId, settlement.id), eq(payouts.userId, c.userId)))
        .limit(1);
      if (old) existing.push(old);
    }
  }

  return { inserted, existing };
}

async function primaryWalletFor(db: LedgerDb, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ address: wallets.address })
    .from(wallets)
    .where(
      and(eq(wallets.userId, userId), eq(wallets.chain, 'solana'), eq(wallets.isPrimary, true)),
    )
    .limit(1);
  return row?.address ?? null;
}
