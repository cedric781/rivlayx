import type { Transaction, VersionedTransaction } from '@solana/web3.js';

/**
 * Privy delegated-signing port (Phase 2). Core depends only on this interface —
 * never on the Privy SDK — so `PrivySolanaTransferProvider` is unit-testable
 * with a mock, and the SDK lives behind one adapter file (`apps/web`). The
 * concrete adapter calls `walletApi.solana.signAndSendTransaction`.
 */

/** Solana CAIP-2 chain ids accepted by Privy's `signAndSendTransaction`. */
export const SOLANA_CAIP2 = {
  mainnet: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  devnet: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
  testnet: 'solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z',
} as const;
export type SolanaCaip2 = (typeof SOLANA_CAIP2)[keyof typeof SOLANA_CAIP2];

export interface PrivySignAndSendRequest {
  /** Source embedded wallet (base58) that signs — the delegated wallet. */
  fromWallet: string;
  /** Target Solana cluster. */
  caip2: SolanaCaip2;
  /**
   * Idempotency key — Privy returns the same result for the same key and never
   * double-submits. We pass the transfer `reference` (domain row id).
   */
  idempotencyKey: string;
  /** Unsigned transfer transaction built by core; forwarded opaquely to Privy. */
  transaction: Transaction | VersionedTransaction;
}

export interface PrivySignAndSendResult {
  /** Solana transaction signature (base58). */
  txSignature: string;
}

/**
 * Delegated signer over a user's Privy embedded wallet. Sign + submit a
 * pre-built USDC transfer. MUST be idempotent on `idempotencyKey`.
 */
export interface PrivySolanaSigner {
  signAndSend(req: PrivySignAndSendRequest): Promise<PrivySignAndSendResult>;
}
