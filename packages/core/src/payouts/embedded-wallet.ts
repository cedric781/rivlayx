import { and, eq } from 'drizzle-orm';
import { wallets } from '@rivlayx/db';
import type { LedgerDb } from '../ledger/types';

/**
 * Embedded-wallet verification (Phase 6). Resolves the Privy embedded wallet a
 * user signs from for delegated transfers (stakes, withdrawals) and verifies it
 * is signing-ready. The `delegated` flag is mirrored into `auth.wallets` at
 * provisioning/verify time, so this is a pure READ — no Privy SDK call, no write.
 *
 * It is the source of `fromWallet` for a Privy withdrawal: refusing here (typed
 * error) keeps an un-delegated or non-embedded wallet from ever reaching the
 * signer.
 */

export type EmbeddedWalletErrorCode = 'NOT_FOUND' | 'NOT_EMBEDDED' | 'NOT_DELEGATED';

export class EmbeddedWalletError extends Error {
  readonly code: EmbeddedWalletErrorCode;
  constructor(code: EmbeddedWalletErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'EmbeddedWalletError';
  }
}

export interface DelegatedEmbeddedWallet {
  /** The embedded wallet address (base58) — the delegated signing source. */
  address: string;
  /** Always true on a resolved wallet (an un-delegated wallet throws instead). */
  delegated: true;
}

/**
 * Resolve + verify the user's delegated Solana embedded wallet. Prefers the
 * primary wallet, falls back to the first embedded one. Throws a typed
 * `EmbeddedWalletError` when there is no wallet (`NOT_FOUND`), none is a Privy
 * embedded wallet (`NOT_EMBEDDED`), or the embedded wallet has not granted
 * delegated signing (`NOT_DELEGATED`).
 */
interface WalletRow {
  address: string;
  source: string;
  delegated: boolean;
  isPrimary: boolean;
}

export async function resolveDelegatedEmbeddedWallet(
  db: LedgerDb,
  userId: string,
): Promise<DelegatedEmbeddedWallet> {
  const rows = (await db
    .select({
      address: wallets.address,
      source: wallets.source,
      delegated: wallets.delegated,
      isPrimary: wallets.isPrimary,
    })
    .from(wallets)
    .where(and(eq(wallets.userId, userId), eq(wallets.chain, 'solana')))) as WalletRow[];

  if (rows.length === 0) {
    throw new EmbeddedWalletError('NOT_FOUND', `no solana wallet for user ${userId}`);
  }

  const embedded = rows.filter((w) => w.source === 'privy_embedded');
  if (embedded.length === 0) {
    throw new EmbeddedWalletError('NOT_EMBEDDED', `user ${userId} has no privy embedded wallet`);
  }

  const chosen = embedded.find((w) => w.isPrimary) ?? embedded[0]!;
  if (!chosen.delegated) {
    throw new EmbeddedWalletError(
      'NOT_DELEGATED',
      `embedded wallet for user ${userId} has not granted delegated signing`,
    );
  }

  return { address: chosen.address, delegated: true };
}
