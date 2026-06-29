export interface TransferInput {
  /** Unique deterministic reference for this transfer (we use payouts.id). */
  reference: string;
  /** Destination wallet address (base58 for Solana). */
  toWallet: string;
  /** USDC amount as decimal string with up to 6 places. */
  amountUsdc: string;
  /** Bet ID for traceability. */
  betId: string;
  /**
   * Source wallet (base58). Optional + additive (Privy migration): the raw-vault
   * provider ignores it (source is always the vault); the Privy provider signs
   * from this user embedded wallet. Existing callers/providers are unaffected.
   */
  fromWallet?: string;
}

export interface TransferResult {
  /** Solana transaction signature (base58, 64..88 chars). */
  txSignature: string;
}

/**
 * Solana USDC SPL-token transfer abstraction. Sprint 11 ships:
 *   - MockSolanaTransferProvider — in-memory, used by tests
 *   - DevnetSolanaTransferProvider — stub that errors when not configured
 *
 * Real mainnet implementation is intentionally out of scope.
 *
 * Contract:
 *   - On success: returns a `TransferResult` with a tx signature.
 *   - On transient failure (RPC down, network, blockhash expired):
 *     throws `TransferRetryableError`. The runner re-enqueues with backoff.
 *   - On permanent failure (bad destination, insufficient vault, blacklisted):
 *     throws `TransferPermanentError`. The runner marks the payout `failed`.
 *   - MUST be idempotent on `reference` — replaying the same reference must
 *     return the same signature, not double-spend.
 */
export interface SolanaTransferProvider {
  readonly name: string;
  buildAndSubmitTransfer(input: TransferInput): Promise<TransferResult>;
}
