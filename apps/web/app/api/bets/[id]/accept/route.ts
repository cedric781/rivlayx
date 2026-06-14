import { NextResponse } from 'next/server';
import { z } from 'zod';
import { bets as betEngine, marketplace } from '@rivlayx/core';
import { requireSession } from '@rivlayx/auth/next';
import { getDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

const Body = z.object({
  /** Side label the acceptor takes; must differ from the creator's side. */
  acceptorSide: z.string().trim().min(1).max(64),
});

/** Map a bet-engine error code to an HTTP status. */
const STATUS_BY_CODE: Record<string, number> = {
  NOT_FOUND: 404,
  SAME_USER: 409,
  ALREADY_ACCEPTED: 409,
  WRONG_STATUS: 409,
  EXPIRED_WINDOW: 409,
  INVALID_SIDE: 400,
  INVALID_INPUT: 400,
  INSUFFICIENT_BALANCE: 402,
  NOT_AUTHORIZED: 403,
  FROZEN: 503,
};

/**
 * Accept an OPEN bet: locks the acceptor's stake into escrow and transitions
 * the bet OPEN → ACTIVE. All business rules (not-creator, OPEN, not-expired,
 * sufficient balance, no existing acceptor, side validity, freeze) are enforced
 * by `acceptBet()` inside a single transaction — this route only authenticates,
 * validates the body shape, and maps errors to HTTP statuses.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user } = await requireSession(getDb, { app: 'user', loginPath: '/login' });

  const json: unknown = await request.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'INVALID_INPUT', message: 'acceptorSide (1..64 chars) required' } },
      { status: 400 },
    );
  }

  const db = getDb();

  // Resolve UUID / short code / share slug to a canonical bet id.
  const detail = await marketplace.getMarketplaceBet(db, id);
  if (!detail) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Bet not found' } },
      { status: 404 },
    );
  }

  try {
    const result = await betEngine.acceptBet(db, {
      betId: detail.id,
      acceptorUserId: user.id,
      acceptorSide: parsed.data.acceptorSide,
    });
    return NextResponse.json({
      bet: { id: result.bet.id, status: result.bet.status },
      acceptorParticipant: {
        side: result.acceptorParticipant.side,
        stakeLockedUsdc: result.acceptorParticipant.stakeLockedUsdc,
      },
    });
  } catch (err) {
    if (err instanceof betEngine.BetError) {
      const status = STATUS_BY_CODE[err.code] ?? 400;
      return NextResponse.json({ error: { code: err.code, message: err.message } }, { status });
    }
    throw err;
  }
}
