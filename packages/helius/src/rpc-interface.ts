/**
 * Minimal Helius/Solana RPC surface used by the deposit pipeline.
 * Sprint 4 ships only the interface + an in-memory mock; the live client
 * lands in Sprint 5.
 */
export interface SignatureStatus {
  signature: string;
  confirmationStatus: 'processed' | 'confirmed' | 'finalized' | null;
  confirmations: number | null;
  slot: number | null;
  err: unknown | null;
}

export interface TokenAccountBalance {
  /** Raw token units as a string (matches Solana RPC `amount` field). */
  amount: string;
  decimals: number;
  uiAmount: number | null;
  /** Decimal string at full precision — preferred for ledger math. */
  uiAmountString: string;
}

export interface SignatureInfo {
  signature: string;
  slot: number;
  blockTime: number | null;
}

export interface SignaturesForAddressOptions {
  limit?: number;
  before?: string;
  until?: string;
}

export interface IHeliusRpc {
  getSignatureStatus(signature: string): Promise<SignatureStatus | null>;
  getTokenAccountBalance(address: string): Promise<TokenAccountBalance>;
  getSignaturesForAddress(
    address: string,
    options?: SignaturesForAddressOptions,
  ): Promise<SignatureInfo[]>;
}
