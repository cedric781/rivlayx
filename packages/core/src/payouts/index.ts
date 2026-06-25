export {
  PayoutError,
  TransferPermanentError,
  TransferRetryableError,
  type PayoutErrorCode,
} from './errors';
export { PAYOUT_LIMITS, nextBackoffMs, validatePayoutAmount } from './cap';
export type { SolanaTransferProvider, TransferInput, TransferResult } from './types';
export { MockSolanaTransferProvider } from './transfer-mock';
export { DevnetSolanaTransferProvider, type DevnetConfig } from './transfer-devnet';
export { queuePayoutsForSettlement, type QueuePayoutsResult } from './queue';
export {
  enqueueForSettlement,
  queuePendingForSettledBets,
  type EnqueueOutcome,
  type EnqueuePendingResult,
} from './enqueue';
export {
  processPayoutQueue,
  processOnePayout,
  type ProcessPayoutQueueOptions,
  type ProcessPayoutQueueResult,
  type ProcessOnePayoutResult,
} from './runner';
// Privy delegated-signing provider surface (Phase 4 wiring). Re-exports the
// already-built provider + the types `buildTransferProvider` needs to assemble
// and inject it. No new logic — exposure only.
export {
  PrivySolanaTransferProvider,
  type PrivyTransferProviderConfig,
} from './privy-transfer';
export {
  SOLANA_CAIP2,
  type SolanaCaip2,
  type PrivySolanaSigner,
  type PrivySignAndSendRequest,
  type PrivySignAndSendResult,
} from './privy-signer-port';
export { type PrivyTransferPolicy } from './privy-policy';
