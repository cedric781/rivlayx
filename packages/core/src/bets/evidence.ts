import { and, eq, sql } from 'drizzle-orm';
import { betEvents, betEvidence, type BetStatus, type NewBetEvidence } from '@rivlayx/db';
import { BetError } from './errors';
import type { BetDb, SubmitEvidenceInput, SubmitEvidenceResult } from './types';

const MAX_UPLOADS_PER_USER_PER_BET = 5;

/**
 * Record an evidence upload for an evidence-resolve bet.
 *
 *   - Bet must be ACTIVE or AWAITING_RESULT.
 *   - `resolve_type` must be `'evidence'`.
 *   - Uploader must be the creator or acceptor.
 *   - `evidence_deadline`, when set, must not have passed.
 *   - Each participant may upload at most `MAX_UPLOADS_PER_USER_PER_BET` files.
 *
 * The upload itself happens against object storage out of band — this
 * function records the metadata + sha256 + the storage key the caller already
 * uploaded to. Files are immutable; correcting evidence requires a new upload.
 */
export async function submitEvidence(
  db: BetDb,
  input: SubmitEvidenceInput,
): Promise<SubmitEvidenceResult> {
  return db.transaction(async (tx: BetDb) => {
    const rows = await tx.execute(
      sql`SELECT id, creator_user_id, acceptor_user_id, status, resolve_type,
                 evidence_deadline
          FROM "app"."bets"
          WHERE id = ${input.betId}
          FOR UPDATE`,
    );
    const row =
      (rows as { rows?: Array<Record<string, unknown>> }).rows?.[0] ??
      (Array.isArray(rows) ? (rows[0] as Record<string, unknown> | undefined) : undefined);
    if (!row) throw new BetError('NOT_FOUND', `bet ${input.betId} not found`);

    const status = row['status'] as BetStatus;
    if (status !== 'ACTIVE' && status !== 'AWAITING_RESULT') {
      throw new BetError(
        'WRONG_STATUS',
        `evidence can only be submitted while bet is ACTIVE or AWAITING_RESULT, got ${status}`,
      );
    }
    if (row['resolve_type'] !== 'evidence') {
      throw new BetError(
        'INVALID_RESOLVE_CONFIG',
        `bet uses ${String(row['resolve_type'])} resolve, not evidence`,
      );
    }
    const isParticipant =
      input.uploaderUserId === row['creator_user_id'] ||
      input.uploaderUserId === row['acceptor_user_id'];
    if (!isParticipant) {
      throw new BetError('NOT_AUTHORIZED', 'uploader is not a participant of this bet');
    }
    const deadline = row['evidence_deadline'] ? new Date(row['evidence_deadline'] as string) : null;
    if (deadline && deadline.getTime() <= Date.now()) {
      throw new BetError('EXPIRED_WINDOW', 'evidence deadline has passed');
    }

    const existing = await tx
      .select({ id: betEvidence.id })
      .from(betEvidence)
      .where(
        and(
          eq(betEvidence.betId, input.betId),
          eq(betEvidence.uploaderUserId, input.uploaderUserId),
        ),
      );
    if (existing.length >= MAX_UPLOADS_PER_USER_PER_BET) {
      throw new BetError(
        'INVALID_INPUT',
        `evidence upload cap reached (max ${MAX_UPLOADS_PER_USER_PER_BET} per user per bet)`,
      );
    }

    const newRow: NewBetEvidence = {
      betId: input.betId,
      uploaderUserId: input.uploaderUserId,
      storageKey: input.storageKey,
      sha256: input.sha256,
      contentType: input.contentType ?? null,
      metadata: input.metadata ?? null,
    };
    const [inserted] = await tx.insert(betEvidence).values(newRow).returning();
    if (!inserted) throw new BetError('INVALID_INPUT', 'failed to insert evidence');

    await tx.insert(betEvents).values({
      betId: input.betId,
      eventType: 'bet_disputed', // closest semantic event for in-flight resolution activity
      actorUserId: input.uploaderUserId,
      payload: {
        kind: 'evidence_submitted',
        evidenceId: inserted.id,
        sha256: input.sha256,
        contentType: input.contentType ?? null,
      },
    });

    return { evidence: inserted };
  });
}
