export type PayoutErrorCode =
  | 'NOT_FOUND'
  | 'WRONG_STATUS'
  | 'INVALID_INPUT'
  | 'AMOUNT_EXCEEDS_CAP'
  | 'NO_PRIMARY_WALLET'
  | 'FROZEN'
  | 'ALREADY_QUEUED'
  | 'TRANSFER_FAILED';

export class PayoutError extends Error {
  readonly code: PayoutErrorCode;

  constructor(code: PayoutErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = 'PayoutError';
  }
}

/**
 * Thrown by `SolanaTransferProvider.buildAndSubmitTransfer` when the failure
 * is transient — the runner will keep the payout in `pending` state and
 * apply exponential backoff before the next attempt.
 */
export class TransferRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransferRetryableError';
  }
}

/**
 * Thrown by `SolanaTransferProvider.buildAndSubmitTransfer` when the failure
 * is final — invalid destination, blacklisted address, deserialisation error.
 * The runner moves the payout to `failed` immediately.
 */
export class TransferPermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransferPermanentError';
  }
}
