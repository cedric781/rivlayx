import { NextResponse } from 'next/server';
import { z } from 'zod';
import { freezeComponentValues, type FreezeComponent } from '@rivlayx/db';
import { ledger, admin } from '@rivlayx/core';
import { getDb } from '@/lib/db';
import { getRequestIp, requireAdminApi } from '@/lib/auth/require-admin-api';

const Body = z.object({
  component: z.enum(freezeComponentValues),
  frozen: z.boolean(),
  reason: z.string().min(1).max(2000),
});

export async function POST(request: Request) {
  const json: unknown = await request.json().catch(() => null);
  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'INVALID_INPUT', message: 'component + frozen + reason required' } },
      { status: 400 },
    );
  }
  const component = parsed.data.component as FreezeComponent;

  // 'all' requires super_admin; other components require admin.
  const auth = await requireAdminApi({
    permission: component === 'all' ? 'emergencyFreezeAll' : 'freezeComponent',
  });
  if (!auth.ok) return auth.response;

  const db = getDb();
  await ledger.setFreeze(db, component, parsed.data.frozen, {
    actorUserId: auth.user.id,
    reason: parsed.data.reason,
  });
  // Audit must include action context — call inside a small txn to keep both moves atomic.
  await db.transaction(async (tx) => {
    await admin.logAdminAction(tx, {
      actorUserId: auth.user.id,
      actorRole: auth.actorRole,
      action: parsed.data.frozen ? 'freeze.enable' : 'freeze.disable',
      targetType: 'freeze',
      targetId: component,
      reason: parsed.data.reason,
      metadata: { component, frozen: parsed.data.frozen },
      ip: getRequestIp(request),
      userAgent: request.headers.get('user-agent'),
    });
  });

  return NextResponse.json({ ok: true, component, frozen: parsed.data.frozen });
}
