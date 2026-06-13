export type LedgerErrorCode =
  | 'INVALID_INPUT'
  | 'AMOUNT_NOT_POSITIVE'
  | 'UNBALANCED'
  | 'SINGLE_SIDED'
  | 'MISSING_AFFECTS_USER'
  | 'INCONSISTENT_AFFECTS_USER'
  | 'INVALID_USER_REF';

export class LedgerError extends Error {
  public readonly code: LedgerErrorCode;
  constructor(code: LedgerErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'LedgerError';
  }
}
