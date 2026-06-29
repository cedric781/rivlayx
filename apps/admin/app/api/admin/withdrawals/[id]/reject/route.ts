import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withdrawals } from '@rivlayx/core';
import { getDb } from '@/lib/db';
import { requireAdminApi } from '@/lib/auth/require-admin-api';

const UUID = z.string().uuid();
const Body = z.object({ reason: z.string().max(2000).optional() });

const STATUS_BY_CODE: Record<string, number> = { NOT_FOUND: 404, WRONG_STATUS: 409 };

/** Admin reject a withdrawal (Sprint 31): pending_review → rejected. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsedId = UUID.safeParse(id);
  if (!parsedId.success) {
    return NextResponse.json(
      { error: { code: 'INVALID_INPUT', message: 'Invalid withdrawal id' } },
      { status: 400 },
    );
  }
  const json: unknown = await request.json().catch(() => null);
  const body = Body.safeParse(json ?? {});

  const auth = await requireAdminApi({ permission: 'approveWithdrawal' });
  if (!auth.ok) return auth.response;

  try {
    const result = await withdrawals.rejectWithdrawal(getDb(), {
      requestId: parsedId.data,
      adminUserId: auth.user.id,
      actorRole: auth.actorRole,
      reason: body.success ? body.data.reason : undefined,
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
