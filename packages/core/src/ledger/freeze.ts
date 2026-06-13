import { eq } from 'drizzle-orm';
import { freezeState, type FreezeComponent } from '@rivlayx/db';
import type { LedgerDb } from './types';

/**
 * Whether the given component is frozen. `all=true` overrides every other
 * component — if `all` is frozen, every check returns `true`.
 */
export async function isFrozen(db: LedgerDb, component: FreezeComponent): Promise<boolean> {
  if (component === 'all') {
    const [row] = await db
      .select({ frozen: freezeState.frozen })
      .from(freezeState)
      .where(eq(freezeState.component, 'all'))
      .limit(1);
    return row?.frozen ?? false;
  }

  const [allRow] = await db
    .select({ frozen: freezeState.frozen })
    .from(freezeState)
    .where(eq(freezeState.component, 'all'))
    .limit(1);
  if (allRow?.frozen) return true;

  const [row] = await db
    .select({ frozen: freezeState.frozen })
    .from(freezeState)
    .where(eq(freezeState.component, component))
    .limit(1);
  return row?.frozen ?? false;
}

export interface SetFreezeOptions {
  /** Acting admin's user id, or `null` for an automated/system freeze (e.g. recon escalation). */
  actorUserId: string | null;
  reason: string;
}

/**
 * UPSERT a freeze component to a desired state. The migration seeds the four
 * standard components; this also handles new components defensively.
 */
export async function setFreeze(
  db: LedgerDb,
  component: FreezeComponent,
  frozen: boolean,
  options: SetFreezeOptions,
): Promise<void> {
  await db
    .insert(freezeState)
    .values({
      component,
      frozen,
      frozenByUserId: options.actorUserId,
      reason: options.reason,
    })
    .onConflictDoUpdate({
      target: freezeState.component,
      set: {
        frozen,
        frozenByUserId: options.actorUserId,
        reason: options.reason,
        changedAt: new Date(),
      },
    });
}
