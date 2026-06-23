import type { WalletSource } from '@rivlayx/db';

export interface LoginInput {
  email: string;
}

export interface LoginResult {
  token: string;
}

export interface VerifiedIdentity {
  /** Stable external identifier — `mock_xxx` in dev, Privy DID in prod. */
  externalId: string;
  email: string;
  walletAddress: string;
  walletSource: WalletSource;
  /**
   * Whether the embedded wallet has Privy delegated-signing granted. Optional —
   * absent/false until the user grants it. Storage-only in Phase 1 (no signing).
   */
  delegated?: boolean;
}

/**
 * Pluggable identity provider. Implementations: MockAuthProvider (Sprint 1),
 * PrivyAuthProvider (Sprint 2+). The route handlers depend only on this
 * interface — swapping providers is a config change.
 */
export interface AuthProvider {
  readonly name: string;
  login(input: LoginInput): Promise<LoginResult>;
  verify(token: string): Promise<VerifiedIdentity>;
}
