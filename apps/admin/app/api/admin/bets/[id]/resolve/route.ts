import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { bets as betsTable } from '@rivlayx/db';
import { bets, admin } from '@rivlayx/core';
import { getDb } from '@/lib/db';
import { getRequestIp, requireAdminApi } from '@/lib/auth/require-admin-api';

const UUID = z.string().uuid();
const Body = z.object({
  /** Which participant the admin rules in favour of. */
  winner: z.enum(['creator', 'acceptor']),
  reason: z.string().max(2000).optional(),
});

/**
 * Admin resolution of an ACTIVE / AWAITING_RESULT bet (Sprint 29). Drives the
 * EXISTING resolve engine only — no new settlement or payout logic:
 *
 *   1. ACTIVE → AWAITING_RESULT via `transitionToAwaitingResult` (admin actor).
 *   2. `proposeResult` records the chosen winner (creator|acceptor) and opens
 *      the standard dispute window.
 *
 * Downstream is untouched: the auto-resolve cron closes the elapsed window
 * (→ RESOLVED) and the settle cron settles it. This route only authenticates,
 * resolves the winner's user id, calls the engine, and writes the admin audit.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsedId = UUID.safeParse(id);
  if (!parsedId.success) {
    return NextResponse.json(
      { error: { code: 'INVALID_INPUT', message: 'Invalid bet id' } },
      { status: 400 },
    );
  }
  const json: unknown = await request.json().catch(() => null);
  const body = Body.safeParse(json);
  if (!body.success) {
    return NextResponse.json(
      { error: { code: 'INVALID_INPUT', message: 'winner required (creator|acceptor)' } },
      { status: 400 },
    );
  }

  const auth = await requireAdminApi({ permission: 'ruleDispute' });
  if (!auth.ok) return auth.response;

  const db = getDb();
  const [bet] = await db
    .select({
      id: betsTable.id,
      status: betsTable.status,
      creatorUserId: betsTable.creatorUserId,
      acceptorUserId: betsTable.acceptorUserId,
    })
    .from(betsTable)
    .where(eq(betsTable.id, parsedId.data))
    .limit(1);
  if (!bet) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Bet not found' } },
      { status: 404 },
    );
  }
  const winnerUserId = body.data.winner === 'creator' ? bet.creatorUserId : bet.acceptorUserId;
  if (!winnerUserId) {
    return NextResponse.json(
      { error: { code: 'INVALID_INPUT', message: 'Bet has no acceptor to rule in favour of' } },
      { status: 409 },
    );
  }

  try {
    // ACTIVE bets must first enter AWAITING_RESULT before a result can be proposed.
    if (bet.status === 'ACTIVE') {
      await bets.transitionToAwaitingResult(db, {
        betId: bet.id,
        actorUserId: auth.user.id,
        reason: body.data.reason ?? 'admin resolution',
      });
    }
    const result = await bets.proposeResult(db, {
      betId: bet.id,
      proposedWinnerUserId: winnerUserId,
      actorType: 'admin',
      actorUserId: auth.user.id,
      reason: body.data.reason ?? `admin ruled ${body.data.winner} as winner`,
    });

    await db.transaction(async (tx) => {
      await admin.logAdminAction(tx, {
        actorUserId: auth.user.id,
        actorRole: auth.actorRole,
        action: 'bet.resolve',
        targetType: 'bet',
        targetId: bet.id,
        reason: body.data.reason ?? null,
        metadata: {
          winner: body.data.winner,
          proposedWinnerUserId: winnerUserId,
          disputeWindowEndsAt: result.disputeWindowEndsAt.toISOString(),
        },
        ip: getRequestIp(request),
        userAgent: request.headers.get('user-agent'),
      });
    });

    return NextResponse.json({
      ok: true,
      winner: body.data.winner,
      bet: { id: result.bet.id, status: result.bet.status },
      proposedWinnerUserId: winnerUserId,
      disputeWindowEndsAt: result.disputeWindowEndsAt.toISOString(),
    });
  } catch (err) {
    if (err instanceof bets.BetError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.code === 'NOT_FOUND' ? 404 : 409 },
      );
    }
    throw err;
  }
}
