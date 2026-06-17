import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withdrawals } from '@rivlayx/core';
import { getDb } from '@/lib/db';
import { requireAdminApi } from '@/lib/auth/require-admin-api';

const UUID = z.string().uuid();

const STATUS_BY_CODE: Record<string, number> = {
  NOT_FOUND: 404,
  WRONG_STATUS: 409,
  FROZEN: 503,
  AMOUNT_EXCEEDS_CAP: 409,
  DAILY_CAP_EXCEEDED: 409,
  INSUFFICIENT_BALANCE: 402,
  INVALID_INPUT: 400,
};

/**
 * Admin approve a withdrawal (Sprint 31): pending_review → approved. The engine
 * enforces freeze + per-withdrawal cap + daily cap + balance and writes the
 * audit log. The withdrawal runner then drives approved → processing → paid.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsedId = UUID.safeParse(id);
  if (!parsedId.success) {
    return NextResponse.json(
      { error: { code: 'INVALID_INPUT', message: 'Invalid withdrawal id' } },
      { status: 400 },
    );
  }

  const auth = await requireAdminApi({ permission: 'approveWithdrawal' });
  if (!auth.ok) return auth.response;

  try {
    const result = await withdrawals.approveWithdrawal(getDb(), {
      requestId: parsedId.data,
      adminUserId: auth.user.id,
      actorRole: auth.actorRole,
    });
    return NextResponse.json({ ok: true, withdrawal: { id: result.id, status: result.status } });
  } catch (err) {
    if (err instanceof withdrawals.WithdrawalError) {
      const status = STATUS_BY_CODE[err.code] ?? 400;
      return NextResponse.json({ error: { code: err.code, message: err.message } }, { status });
    }
    throw err;
  }
}
