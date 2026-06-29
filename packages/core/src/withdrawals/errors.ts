export type WithdrawalErrorCode =
  | 'NOT_FOUND'
  | 'WRONG_STATUS'
  | 'INVALID_INPUT'
  | 'AMOUNT_EXCEEDS_CAP'
  | 'DAILY_CAP_EXCEEDED'
  | 'INSUFFICIENT_BALANCE'
  | 'FROZEN';

export class WithdrawalError extends Error {
  constructor(
    readonly code: WithdrawalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'WithdrawalError';
  }
}
