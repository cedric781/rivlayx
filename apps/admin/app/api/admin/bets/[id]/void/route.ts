import { NextResponse } from 'next/server';
import { z } from 'zod';
import { bets, admin } from '@rivlayx/core';
import { getDb } from '@/lib/db';
import { getRequestIp, requireAdminApi } from '@/lib/auth/require-admin-api';

const UUID = z.string().uuid();
const Body = z.object({ reason: z.string().min(1).max(2000) });

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
      { error: { code: 'INVALID_INPUT', message: 'Reason required' } },
      { status: 400 },
    );
  }

  const auth = await requireAdminApi({ permission: 'voidBet' });
  if (!auth.ok) return auth.response;

  const db = getDb();
  try {
    const result = await bets.voidBet(db, {
      betId: parsedId.data,
      actorUserId: auth.user.id,
      reason: body.data.reason,
    });
    await db.transaction(async (tx) => {
      await admin.logAdminAction(tx, {
        actorUserId: auth.user.id,
        actorRole: auth.actorRole,
        action: 'bet.void',
        targetType: 'bet',
        targetId: parsedId.data,
        reason: body.data.reason,
        metadata: { betStatus: result.bet.status },
        ip: getRequestIp(request),
        userAgent: request.headers.get('user-agent'),
      });
    });
    return NextResponse.json({ ok: true, bet: { id: result.bet.id, status: result.bet.status } });
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
