export type BetErrorCode =
  | 'INVALID_INPUT'
  | 'OBJECTIVE_VALIDATION_FAILED'
  | 'SUBJECTIVE_LANGUAGE'
  | 'UNKNOWN_PREDICATE'
  | 'PREDICATE_TITLE_MISMATCH'
  | 'TEMPLATE_NOT_FOUND'
  | 'TEMPLATE_INACTIVE'
  | 'TEMPLATE_PREDICATE_MISMATCH'
  | 'INVALID_SIDE'
  | 'SAME_USER'
  | 'STAKE_TOO_LARGE'
  | 'INSUFFICIENT_BALANCE'
  | 'FROZEN'
  | 'WRONG_STATUS'
  | 'NOT_FOUND'
  | 'NOT_AUTHORIZED'
  | 'EXPIRED_WINDOW'
  | 'INVALID_EXPIRES_AT'
  | 'INVALID_ARBITER'
  | 'INVALID_RESOLVE_CONFIG'
  | 'ALREADY_ACCEPTED';

export class BetError extends Error {
  public readonly code: BetErrorCode;
  public readonly details?: Record<string, unknown>;
  constructor(code: BetErrorCode, message: string, details?: Record<string, unknown>) {
    super(`[${code}] ${message}`);
    this.code = code;
    this.name = 'BetError';
    if (details) this.details = details;
  }
}
