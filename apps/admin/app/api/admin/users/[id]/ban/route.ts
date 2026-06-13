import { NextResponse } from 'next/server';
import { z } from 'zod';
import { admin } from '@rivlayx/core';
import { getDb } from '@/lib/db';
import { getRequestIp, requireAdminApi } from '@/lib/auth/require-admin-api';

const UUID = z.string().uuid();
const Body = z.object({ reason: z.string().min(1).max(2000) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsedId = UUID.safeParse(id);
  if (!parsedId.success) {
    return NextResponse.json(
      { error: { code: 'INVALID_INPUT', message: 'Invalid user id' } },
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

  const auth = await requireAdminApi({ permission: 'banUser' });
  if (!auth.ok) return auth.response;

  try {
    const result = await admin.banUser(getDb(), {
      userId: parsedId.data,
      actorUserId: auth.user.id,
      actorRole: auth.actorRole,
      reason: body.data.reason,
      ip: getRequestIp(request),
      userAgent: request.headers.get('user-agent'),
    });
    return NextResponse.json({
      ok: true,
      user: { id: result.user.id, status: result.user.status },
    });
  } catch (err) {
    if (err instanceof admin.ModerationError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.code === 'NOT_FOUND' ? 404 : 409 },
      );
    }
    throw err;
  }
}
