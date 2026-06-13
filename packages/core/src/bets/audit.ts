import {
  betAuditLog,
  betEvents,
  type ActorType,
  type BetEventType,
  type BetStatus,
} from '@rivlayx/db';
import type { LedgerDb } from '../ledger/types';

export interface RecordTransitionInput {
  betId: string;
  fromStatus: BetStatus | null;
  toStatus: BetStatus;
  eventType: BetEventType;
  actorUserId?: string | null;
  actorType: ActorType;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Record a bet state transition. Writes one row to `bet_audit_log` (strict
 * state-transition history, immutable) and one row to `bet_events`
 * (business-level event feed, used for UI + notifications).
 *
 * Must be called inside the same transaction as the bet UPDATE so the audit
 * trail moves atomically with the state change.
 */
export async function recordBetTransition(
  tx: LedgerDb,
  input: RecordTransitionInput,
): Promise<void> {
  await tx.insert(betAuditLog).values({
    betId: input.betId,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    actorUserId: input.actorUserId ?? null,
    actorType: input.actorType,
    reason: input.reason ?? null,
    metadata: input.metadata ?? {},
  });
  await tx.insert(betEvents).values({
    betId: input.betId,
    eventType: input.eventType,
    actorUserId: input.actorUserId ?? null,
    payload: input.metadata ?? {},
  });
}
