import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { opsAlerts } from '@rivlayx/db';
import { OPS_DEFAULTS, type OpsConfig } from './config';
import type { DispatchableAlert, OpsAlertSpec } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OpsDb = any;

/**
 * Upsert one ops alert with dedup + suppression:
 * - existing **open** alert for (type, dedupKey) → refresh in place (no re-page).
 * - existing **acknowledged** alert → refresh evidence, keep acknowledged
 *   (suppressed: an operator is already on it; do not re-page).
 * - otherwise insert a fresh **open** alert (this is what gets dispatched).
 * Returns the **persisted alert** (id + runbookUrl + createdAt) when a NEW open
 * alert was created (→ dispatch), or `null` when deduped/suppressed (→ no page).
 */
export async function upsertOpsAlert(
  db: OpsDb,
  spec: OpsAlertSpec,
  config: OpsConfig = OPS_DEFAULTS,
): Promise<DispatchableAlert | null> {
  const [existing] = await db
    .select({ id: opsAlerts.id, status: opsAlerts.status })
    .from(opsAlerts)
    .where(
      and(eq(opsAlerts.type, spec.type), eq(opsAlerts.dedupKey, spec.dedupKey), ne(opsAlerts.status, 'resolved')),
    )
    .orderBy(desc(opsAlerts.createdAt))
    .limit(1);

  if (existing) {
    await db
      .update(opsAlerts)
      .set({ severity: spec.severity, title: spec.title, evidence: spec.evidence, updatedAt: new Date() })
      .where(eq(opsAlerts.id, existing.id));
    return null; // already open/acknowledged → no new page
  }

  const runbookUrl = config.runbooks[spec.type] ?? null;
  const [row] = await db
    .insert(opsAlerts)
    .values({
      type: spec.type,
      severity: spec.severity,
      dedupKey: spec.dedupKey,
      title: spec.title,
      evidence: spec.evidence,
      runbookUrl,
      status: 'open',
    })
    .returning({ id: opsAlerts.id, createdAt: opsAlerts.createdAt, runbookUrl: opsAlerts.runbookUrl });

  return {
    id: row.id,
    type: spec.type,
    severity: spec.severity,
    dedupKey: spec.dedupKey,
    title: spec.title,
    evidence: spec.evidence,
    runbookUrl: row.runbookUrl,
    createdAt: row.createdAt,
  };
}

/**
 * Auto-resolve alerts whose condition has cleared — any open/acknowledged alert
 * not present in the current active (type|dedupKey) set is resolved. Keeps the
 * board self-healing so a transient blip doesn't linger.
 */
export async function resolveClearedOpsAlerts(db: OpsDb, activeKeys: string[]): Promise<number> {
  const open = await db
    .select({ id: opsAlerts.id, type: opsAlerts.type, dedupKey: opsAlerts.dedupKey })
    .from(opsAlerts)
    .where(ne(opsAlerts.status, 'resolved'));

  const toResolve = open.filter(
    (a: { type: string; dedupKey: string }) => !activeKeys.includes(`${a.type}|${a.dedupKey}`),
  );
  if (toResolve.length === 0) return 0;

  const now = new Date();
  await db
    .update(opsAlerts)
    .set({ status: 'resolved', resolvedAt: now, updatedAt: now })
    .where(
      sql`${opsAlerts.id} in (${sql.join(
        toResolve.map((a: { id: string }) => sql`${a.id}`),
        sql`, `,
      )})`,
    );
  return toResolve.length;
}
