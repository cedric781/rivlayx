import { and, eq } from 'drizzle-orm';
import { wallets } from '@rivlayx/db';

/**
 * Loose Drizzle handle accepting both the production postgres-js driver and the
 * pglite test driver — same motivation as `LedgerDb` / `AuthDb` elsewhere.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WalletDb = any;

export interface EmbeddedWallet {
  userId: string;
  address: string;
  /** Whether Privy delegated-signing is granted on this wallet (Phase 1: storage only). */
  delegated: boolean;
  delegationGrantedAt: Date | null;
}

/**
 * Resolve a user's canonical money wallet: the single primary, Privy-embedded
 * Solana wallet.
 *
 * Invariant (Privy migration): an active user has EXACTLY ONE primary
 * `privy_embedded` Solana wallet. This function enforces it:
 *   - returns the wallet when present,
 *   - returns `null` when the user has none (not yet provisioned),
 *   - throws when more than one exists — a data-integrity break that must never
 *     be papered over (it would make "which wallet holds the money" ambiguous).
 *
 * Read-only. No signing, no transfers — Phase 1 provisioning support only.
 */
export async function getUserEmbeddedWallet(
  db: WalletDb,
  userId: string,
): Promise<EmbeddedWallet | null> {
  const rows = await db
    .select({
      userId: wallets.userId,
      address: wallets.address,
      delegated: wallets.delegated,
      delegationGrantedAt: wallets.delegationGrantedAt,
    })
    .from(wallets)
    .where(
      and(
        eq(wallets.userId, userId),
        eq(wallets.chain, 'solana'),
        eq(wallets.source, 'privy_embedded'),
        eq(wallets.isPrimary, true),
      ),
    )
    .limit(2);

  if (rows.length === 0) return null;
  if (rows.length > 1) {
    throw new Error(
      `invariant violation: user ${userId} has multiple primary privy_embedded Solana wallets`,
    );
  }
  return rows[0] as EmbeddedWallet;
}
