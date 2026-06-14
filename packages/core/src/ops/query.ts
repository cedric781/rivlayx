import { desc, eq, ne, sql } from 'drizzle-orm';
import { opsAlerts, type OpsAlertStatus, type OpsAlertType, type OpsSeverity } from '@rivlayx/db';
import { OPS_DEFAULTS, type OpsConfig } from './config';
import { getCronHealth } from './cron-runs';
import type { CronHealth } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OpsDb = any;

export interface OpsAlertRow {
  id: string;
  type: OpsAlertType;
  severity: OpsSeverity;
  status: OpsAlertStatus;
  title: string;
  evidence: unknown;
  runbookUrl: string | null;
  createdAt: Date;
}

/** Active (open + acknowledged) ops alerts, most severe / recent first. */
export async function listActiveOpsAlerts(db: OpsDb, opts: { limit?: number } = {}): Promise<OpsAlertRow[]> {
  const limit = Math.min(200, Math.max(1, opts.limit ?? 100));
  return db
    .select({
      id: opsAlerts.id,
      type: opsAlerts.type,
      severity: opsAlerts.severity,
      status: opsAlerts.status,
      title: opsAlerts.title,
      evidence: opsAlerts.evidence,
      runbookUrl: opsAlerts.runbookUrl,
      createdAt: opsAlerts.createdAt,
    })
    .from(opsAlerts)
    .where(ne(opsAlerts.status, 'resolved'))
    .orderBy(desc(opsAlerts.createdAt))
    .limit(limit);
}

export interface OpsOverview {
  cronHealth: CronHealth[];
  openAlerts: number;
  criticalAlerts: number;
}

/** Compact ops overview for the admin dashboard. */
export async function getOpsOverview(db: OpsDb, config: OpsConfig = OPS_DEFAULTS): Promise<OpsOverview> {
  const cronHealth = await getCronHealth(db, config);
  const [open] = await db
    .select({ n: sql<number>`count(*)` })
    .from(opsAlerts)
    .where(ne(opsAlerts.status, 'resolved'));
  const [crit] = await db
    .select({ n: sql<number>`count(*)` })
    .from(opsAlerts)
    .where(sql`${opsAlerts.status} <> 'resolved' AND ${opsAlerts.severity} = 'critical'`);
  return {
    cronHealth,
    openAlerts: Number(open?.n ?? 0),
    criticalAlerts: Number(crit?.n ?? 0),
  };
}

/** Update an alert's status (admin triage: acknowledge / resolve). Audited upstream. */
export async function setOpsAlertStatus(db: OpsDb, id: string, status: OpsAlertStatus): Promise<void> {
  const now = new Date();
  await db
    .update(opsAlerts)
    .set({ status, updatedAt: now, ...(status === 'resolved' ? { resolvedAt: now } : {}) })
    .where(eq(opsAlerts.id, id));
}
