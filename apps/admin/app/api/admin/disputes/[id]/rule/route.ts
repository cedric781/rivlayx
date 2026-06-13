import { NextResponse } from 'next/server';
import { z } from 'zod';
import { bets, admin } from '@rivlayx/core';
import { getDb } from '@/lib/db';
import { getRequestIp, requireAdminApi } from '@/lib/auth/require-admin-api';

const UUID = z.string().uuid();
const Body = z.object({
  ruling: z.enum(['uphold', 'reject']),
  winnerUserIdOverride: z.string().uuid().optional(),
  notes: z.string().max(2000).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsedId = UUID.safeParse(id);
  if (!parsedId.success) {
    return NextResponse.json(
      { error: { code: 'INVALID_INPUT', message: 'Invalid dispute id' } },
      { status: 400 },
    );
  }
  const json: unknown = await request.json().catch(() => null);
  const body = Body.safeParse(json);
  if (!body.success) {
    return NextResponse.json(
      { error: { code: 'INVALID_INPUT', message: 'ruling required (uphold|reject)' } },
      { status: 400 },
    );
  }

  const auth = await requireAdminApi({ permission: 'ruleDispute' });
  if (!auth.ok) return auth.response;

  const db = getDb();
  try {
    const result = await bets.ruleDispute(db, {
      disputeId: parsedId.data,
      adminUserId: auth.user.id,
      ruling: body.data.ruling,
      winnerUserIdOverride: body.data.winnerUserIdOverride,
      notes: body.data.notes,
    });
    await db.transaction(async (tx) => {
      await admin.logAdminAction(tx, {
        actorUserId: auth.user.id,
        actorRole: auth.actorRole,
        action: 'dispute.rule',
        targetType: 'dispute',
        targetId: parsedId.data,
        reason: body.data.notes ?? null,
        metadata: {
          ruling: body.data.ruling,
          betId: result.bet.id,
          resolvedWinnerUserId: result.bet.resolvedWinnerUserId,
        },
        ip: getRequestIp(request),
        userAgent: request.headers.get('user-agent'),
      });
    });
    return NextResponse.json({ ok: true, ruling: body.data.ruling, betId: result.bet.id });
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
