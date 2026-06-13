/**
 * Predicate types accepted by auto-resolve providers. Mirrors the union
 * defined in `@rivlayx/core/bets/validation/predicate-types` but is
 * intentionally re-declared here as a lightweight contract so this package
 * stays free of `@rivlayx/core` import cycles.
 */
export type PredicateKind =
  | 'team_wins'
  | 'score_over_under'
  | 'price_above'
  | 'price_below'
  | 'event_occurs_before'
  | 'distance_completed';

export interface PredicateBase {
  type: PredicateKind;
}

export interface TeamWinsPredicate extends PredicateBase {
  type: 'team_wins';
  team: string;
  eventReference: string;
}

export interface ScoreOverUnderPredicate extends PredicateBase {
  type: 'score_over_under';
  eventReference: string;
  threshold: number;
  side: 'over' | 'under';
}

export interface PriceAbovePredicate extends PredicateBase {
  type: 'price_above';
  asset: string;
  threshold: number;
  deadlineAt: string;
}

export interface PriceBelowPredicate extends PredicateBase {
  type: 'price_below';
  asset: string;
  threshold: number;
  deadlineAt: string;
}

export type SupportedPredicate =
  | TeamWinsPredicate
  | ScoreOverUnderPredicate
  | PriceAbovePredicate
  | PriceBelowPredicate;

/** Raw, provider-specific payload as returned by `fetchResult`. */
export type RawProviderResponse = Record<string, unknown>;

export interface ValidationOutcome {
  ok: boolean;
  /** Why the raw result is not yet usable. */
  reason?: 'pending' | 'cancelled' | 'malformed' | 'incomplete' | 'voided';
  message?: string;
}

/** Normalized, provider-agnostic result consumed by the bet engine. */
export interface ProviderResult {
  provider: string;
  status: 'final' | 'pending' | 'cancelled' | 'invalid';
  /**
   * Winning side label when status='final'. Compared to `bet.creator_side`
   * to determine the participant winner. Null when status != 'final'.
   */
  winningSide: string | null;
  /** ISO timestamp when the result became final on the provider. */
  resolvedAt: string | null;
  /** Original payload for audit + debugging. */
  rawPayload: RawProviderResponse;
  /** Free-form message for failure / pending states. */
  message?: string;
}

export interface FetchResultInput {
  predicate: SupportedPredicate;
}

/**
 * Common contract every auto-resolve provider implements.
 *
 *   - `supports(predicate)` — predicate gate check
 *   - `fetchResult(input)` — pure I/O fetch from external API
 *   - `validateResult(raw)` — sanity-check the response is final + parseable
 *   - `normalizeResult(raw, predicate)` — derive ProviderResult
 *
 * Implementations split into a Real* class (live HTTP) and a Mock* class
 * (programmable state for tests). The Real* class is invoked only when the
 * caller passes valid env-configured credentials; CI uses the mock.
 */
export interface ResolveProvider {
  readonly name: string;
  supports(predicate: SupportedPredicate): boolean;
  fetchResult(input: FetchResultInput): Promise<RawProviderResponse>;
  validateResult(raw: RawProviderResponse): ValidationOutcome;
  normalizeResult(raw: RawProviderResponse, predicate: SupportedPredicate): ProviderResult;
}
