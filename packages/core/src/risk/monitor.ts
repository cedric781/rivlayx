import { and, desc, eq } from 'drizzle-orm';
import { riskAlerts, type RiskAlertType, type RiskBand, type RiskSubjectType } from '@rivlayx/db';
import { RISK_DEFAULTS, type RiskConfig } from './config';
import type { RiskResult } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RiskDb = any;

/** Map a 0–100 score to a band using the config bands. */
export function bandForScore(score: number, config: RiskConfig = RISK_DEFAULTS): RiskBand {
  for (const b of config.bands) if (score >= b.min) return b.band;
  return 'none';
}

interface AlertSpec {
  subjectType: RiskSubjectType;
  subjectId: string;
  type: RiskAlertType;
  score: number;
  severity: RiskBand;
  evidence: Record<string, unknown>;
}

/**
 * Raise (or refresh) one advisory alert. Dedups on the open (subject, type)
 * partial-unique index. Suppression: if the most recent alert for this
 * (subject, type) was already triaged/dismissed/actioned, we do NOT re-open it
 * — analysts shouldn't see resolved noise again without a fresh investigation.
 * Purely advisory — raising an alert never triggers any action.
 */
async function upsertAlert(db: RiskDb, spec: AlertSpec): Promise<void> {
  const [existing] = await db
    .select({ id: riskAlerts.id, status: riskAlerts.status })
    .from(riskAlerts)
    .where(
      and(
        eq(riskAlerts.subjectType, spec.subjectType),
        eq(riskAlerts.subjectId, spec.subjectId),
        eq(riskAlerts.type, spec.type),
      ),
    )
    .orderBy(desc(riskAlerts.createdAt))
    .limit(1);

  if (existing) {
    if (existing.status === 'open') {
      await db
        .update(riskAlerts)
        .set({
          score: spec.score,
          severity: spec.severity,
          evidence: spec.evidence,
          updatedAt: new Date(),
        })
        .where(eq(riskAlerts.id, existing.id));
    }
    // Non-open (triaged/dismissed/actioned) → suppressed, do nothing.
    return;
  }

  await db.insert(riskAlerts).values({
    subjectType: spec.subjectType,
    subjectId: spec.subjectId,
    type: spec.type,
    score: spec.score,
    severity: spec.severity,
    evidence: spec.evidence,
    status: 'open',
  });
}

/**
 * Raise per-detector + composite alerts for one user from a scored result.
 * Each detector fires independently of the composite once its sub-score crosses
 * the configured threshold.
 */
export async function raiseUserAlerts(
  db: RiskDb,
  userId: string,
  result: RiskResult,
  evidence: Record<string, unknown>,
  config: RiskConfig = RISK_DEFAULTS,
): Promise<void> {
  const th = config.alertThresholds;
  const s = result.subScores;
  const checks: Array<{ type: RiskAlertType; score: number; on: boolean }> = [
    { type: 'ring', score: s.ring, on: s.ring >= th.ring },
    { type: 'wash_trade', score: s.wash, on: s.wash >= th.wash },
    { type: 'dispute_abuse', score: s.abuse, on: s.abuse >= th.abuse },
    { type: 'velocity', score: s.velocity, on: s.velocity >= th.velocity },
    {
      type: 'high_risk_user',
      score: result.riskScore,
      on: result.band === 'high' || result.band === 'critical',
    },
  ];

  for (const c of checks) {
    if (!c.on) continue;
    await upsertAlert(db, {
      subjectType: 'user',
      subjectId: userId,
      type: c.type,
      score: c.score,
      severity: bandForScore(c.score, config),
      evidence: { ...evidence, riskScore: result.riskScore, band: result.band },
    });
  }
}

/** Raise a cluster-level alert (ring or sybil). Advisory only. */
export async function raiseClusterAlert(
  db: RiskDb,
  clusterId: string,
  type: 'ring' | 'sybil',
  score: number,
  evidence: Record<string, unknown>,
  config: RiskConfig = RISK_DEFAULTS,
): Promise<void> {
  await upsertAlert(db, {
    subjectType: 'cluster',
    subjectId: clusterId,
    type,
    score,
    severity: bandForScore(score, config),
    evidence,
  });
}
