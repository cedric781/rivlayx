import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import {
  autoResolveAttempts,
  bets,
  betRules,
  disputes,
  type AutoResolveStatus,
  type BetStatus,
  type NewAutoResolveAttempt,
} from '@rivlayx/db';
import type { ProviderRegistry, ProviderResult, SupportedPredicate } from '@rivlayx/providers';
import { ProviderError } from '@rivlayx/providers';
import { BetError } from './errors';
import { closeDisputeWindow, proposeResult, transitionToAwaitingResult } from './resolve';
import type { BetDb } from './types';

export interface AutoResolveRunResult {
  betId: string;
  status:
    | 'proposed'
    | 'still_pending'
    | 'cancelled_event'
    | 'invalid_result'
    | 'error'
    | 'already_proposed';
  provider?: string;
  winnerUserId?: string | null;
  message?: string;
}

export interface ResolvePendingOptions {
  /** Maximum bets to process this run. */
  limit?: number;
  /** Optional bet-id filter; defaults to all eligible bets. */
  betIds?: string[];
}

export interface CycleResult {
  proposed: AutoResolveRunResult[];
  closed: Array<{ betId: string; kind: 'resolved' | 'noop' }>;
}

const ELIGIBLE_STATUSES: BetStatus[] = ['ACTIVE', 'AWAITING_RESULT'];

/**
 * Find auto-resolve eligible bets and try to advance each one toward a
 * PROPOSED state via the supplied registry.
 *
 *   - Idempotent: bets that already have a `proposed_winner_user_id` are
 *     skipped. The underlying `proposeResult` (Sprint 7) also rejects double
 *     proposals as a defence-in-depth.
 *   - Records every attempt in `auto_resolve_attempts` for admin visibility.
 *   - Never voids a bet automatically — cancelled / invalid results route
 *     to admin review.
 */
export async function resolvePendingBets(
  db: BetDb,
  registry: ProviderRegistry,
  options: ResolvePendingOptions = {},
): Promise<AutoResolveRunResult[]> {
  const limit = options.limit ?? 100;
  const candidates = await selectCandidates(db, options.betIds);

  const results: AutoResolveRunResult[] = [];
  for (const bet of candidates.slice(0, limit)) {
    results.push(await resolveOne(db, registry, bet));
  }
  return results;
}

/**
 * Walk every AWAITING_RESULT bet whose dispute window has elapsed and there
 * is no open dispute, then call `closeDisputeWindow` (Sprint 7). Returns one
 * record per bet inspected.
 */
export async function closeExpiredDisputeWindows(
  db: BetDb,
  options: { limit?: number } = {},
): Promise<Array<{ betId: string; kind: 'resolved' | 'noop' }>> {
  const limit = options.limit ?? 100;
  const rows = await db
    .select({ id: bets.id })
    .from(bets)
    .where(
      and(
        eq(bets.status, 'AWAITING_RESULT'),
        sql`${bets.disputeWindowEndsAt} IS NOT NULL`,
        lte(bets.disputeWindowEndsAt, new Date()),
      ),
    )
    .limit(limit);

  const out: Array<{ betId: string; kind: 'resolved' | 'noop' }> = [];
  for (const row of rows) {
    const r = await closeDisputeWindow(db, { betId: row.id });
    out.push({ betId: row.id, kind: r.kind === 'resolved' ? 'resolved' : 'noop' });
  }
  return out;
}

/** Single combined cycle the cron entry point can invoke. */
export async function runAutoResolveCycle(
  db: BetDb,
  registry: ProviderRegistry,
  options: ResolvePendingOptions = {},
): Promise<CycleResult> {
  const proposed = await resolvePendingBets(db, registry, options);
  const closed = await closeExpiredDisputeWindows(db, options);
  return { proposed, closed };
}

// ───────────── internals ─────────────

interface Candidate {
  id: string;
  status: BetStatus;
  creatorUserId: string;
  acceptorUserId: string | null;
  creatorSide: string;
}

async function selectCandidates(db: BetDb, betIds?: string[]): Promise<Candidate[]> {
  const conditions = and(
    or(...ELIGIBLE_STATUSES.map((s) => eq(bets.status, s))),
    eq(bets.resolveType, 'auto'),
    isNull(bets.proposedWinnerUserId),
    sql`${bets.eventAt} IS NOT NULL`,
    lte(bets.eventAt, new Date()),
    sql`${bets.acceptorUserId} IS NOT NULL`,
  );

  const rows = await db
    .select({
      id: bets.id,
      status: bets.status,
      creatorUserId: bets.creatorUserId,
      acceptorUserId: bets.acceptorUserId,
      creatorSide: bets.creatorSide,
    })
    .from(bets)
    .where(conditions);

  const filtered =
    betIds && betIds.length > 0
      ? (rows as Candidate[]).filter((r) => betIds.includes(r.id))
      : (rows as Candidate[]);
  return filtered;
}

async function resolveOne(
  db: BetDb,
  registry: ProviderRegistry,
  bet: Candidate,
): Promise<AutoResolveRunResult> {
  // Acceptor presence already checked at selection time but narrow for TS.
  if (!bet.acceptorUserId) {
    return { betId: bet.id, status: 'invalid_result', message: 'no acceptor on bet' };
  }

  // Fetch the predicate from bet_rules (rule_index=0 by convention).
  const [rule] = await db
    .select({ predicate: betRules.predicate })
    .from(betRules)
    .where(and(eq(betRules.betId, bet.id), eq(betRules.ruleIndex, 0)))
    .limit(1);
  if (!rule) {
    await logAttempt(db, bet.id, 'unknown', 'invalid', 'no rule found', null, null);
    return { betId: bet.id, status: 'invalid_result', message: 'no rule' };
  }

  const predicate = rule.predicate as SupportedPredicate;
  let provider;
  try {
    provider = registry.getFor(predicate);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logAttempt(db, bet.id, 'unknown', 'error', msg, null, null);
    return { betId: bet.id, status: 'error', message: msg };
  }

  // Advance ACTIVE → AWAITING_RESULT if necessary.
  if (bet.status === 'ACTIVE') {
    try {
      await transitionToAwaitingResult(db, { betId: bet.id });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await logAttempt(db, bet.id, provider.name, 'error', msg, null, null);
      return { betId: bet.id, status: 'error', provider: provider.name, message: msg };
    }
  }

  let raw;
  try {
    raw = await provider.fetchResult({ predicate });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const errMeta = err instanceof ProviderError ? { code: err.code } : null;
    await logAttempt(db, bet.id, provider.name, 'error', msg, null, errMeta);
    return { betId: bet.id, status: 'error', provider: provider.name, message: msg };
  }

  const validation = provider.validateResult(raw);
  if (!validation.ok) {
    const status: AutoResolveStatus =
      validation.reason === 'cancelled'
        ? 'cancelled'
        : validation.reason === 'malformed' || validation.reason === 'incomplete'
          ? 'invalid'
          : 'pending';
    await logAttempt(
      db,
      bet.id,
      provider.name,
      status,
      validation.message ?? validation.reason ?? '',
      raw,
      null,
    );
    return {
      betId: bet.id,
      status:
        status === 'cancelled'
          ? 'cancelled_event'
          : status === 'invalid'
            ? 'invalid_result'
            : 'still_pending',
      provider: provider.name,
      message: validation.message,
    };
  }

  let result: ProviderResult;
  try {
    result = provider.normalizeResult(raw, predicate);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logAttempt(db, bet.id, provider.name, 'invalid', msg, raw, null);
    return { betId: bet.id, status: 'invalid_result', provider: provider.name, message: msg };
  }

  if (result.status !== 'final') {
    const mapped: AutoResolveStatus = result.status === 'cancelled' ? 'cancelled' : 'pending';
    await logAttempt(
      db,
      bet.id,
      provider.name,
      mapped,
      result.message ?? result.status,
      raw,
      result,
    );
    return {
      betId: bet.id,
      status: result.status === 'cancelled' ? 'cancelled_event' : 'still_pending',
      provider: provider.name,
      message: result.message,
    };
  }
  if (!result.winningSide) {
    await logAttempt(
      db,
      bet.id,
      provider.name,
      'invalid',
      'final without winningSide',
      raw,
      result,
    );
    return { betId: bet.id, status: 'invalid_result', provider: provider.name };
  }

  const winnerUserId =
    result.winningSide === bet.creatorSide ? bet.creatorUserId : bet.acceptorUserId;

  try {
    await proposeResult(db, {
      betId: bet.id,
      proposedWinnerUserId: winnerUserId,
      proposedOutcome: {
        provider: provider.name,
        result,
      },
      actorUserId: null,
      actorType: 'system',
      reason: `auto-resolved by ${provider.name}`,
    });
  } catch (err) {
    if (err instanceof BetError && err.code === 'WRONG_STATUS') {
      // someone else already proposed — idempotent return
      await logAttempt(db, bet.id, provider.name, 'final', 'already proposed (race)', raw, result);
      return { betId: bet.id, status: 'already_proposed', provider: provider.name };
    }
    const msg = err instanceof Error ? err.message : String(err);
    await logAttempt(db, bet.id, provider.name, 'error', msg, raw, result);
    return { betId: bet.id, status: 'error', provider: provider.name, message: msg };
  }

  await logAttempt(db, bet.id, provider.name, 'final', null, raw, result);
  return { betId: bet.id, status: 'proposed', provider: provider.name, winnerUserId };
}

async function logAttempt(
  db: BetDb,
  betId: string,
  provider: string,
  status: AutoResolveStatus,
  message: string | null,
  rawPayload: unknown,
  outcome: unknown,
): Promise<void> {
  const row: NewAutoResolveAttempt = {
    betId,
    provider,
    status,
    errorMessage: message,
    rawPayload: (rawPayload as Record<string, unknown> | null) ?? null,
    outcome: (outcome as Record<string, unknown> | null) ?? null,
  };
  await db.insert(autoResolveAttempts).values(row);
}

/** Helper used by tests + admin tooling to count open disputes per bet. */
export async function hasOpenDispute(db: BetDb, betId: string): Promise<boolean> {
  const rows = await db
    .select({ id: disputes.id })
    .from(disputes)
    .where(and(eq(disputes.betId, betId), eq(disputes.status, 'open')))
    .limit(1);
  return rows.length > 0;
}
