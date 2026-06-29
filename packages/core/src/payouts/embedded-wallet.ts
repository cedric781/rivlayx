import { and, eq } from 'drizzle-orm';
import { users, wallets } from '@rivlayx/db';
import type { LedgerDb } from '../ledger/types';

/**
 * Embedded-wallet verification + revocation guard (Phase 6). Resolves the Privy
 * embedded wallet a user signs from for delegated transfers and verifies, on
 * EVERY call (no cache → never stale), that it is still signing-ready. The
 * `delegated` flag is mirrored into `auth.wallets` at provisioning/verify time;
 * a revocation flips it to `false` and is caught here. Pure READ — no Privy SDK
 * call, no write.
 *
 * It is the single source of `fromWallet` for a delegated transfer and is
 * FAIL-CLOSED: an inactive/deleted user, a missing/non-embedded/un-delegated
 * wallet, or an ambiguous set of delegated wallets (e.g. a replacement that did
 * not revoke the old one) all throw a typed `EmbeddedWalletError` instead of
 * letting a stale or wrong wallet reach the signer.
 */

export type EmbeddedWalletErrorCode =
  | 'USER_NOT_FOUND'
  | 'USER_INACTIVE'
  | 'NOT_FOUND'
  | 'NOT_EMBEDDED'
  | 'NOT_DELEGATED'
  | 'AMBIGUOUS_WALLET';

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
 * Resolve + verify the user's delegated Solana embedded wallet, fail-closed.
 * Throws a typed `EmbeddedWalletError`: the user is missing (`USER_NOT_FOUND`)
 * or not active (`USER_INACTIVE`); the user has no wallet (`NOT_FOUND`) or no
 * Privy embedded wallet (`NOT_EMBEDDED`); no embedded wallet is currently
 * delegated (`NOT_DELEGATED`, i.e. never granted or revoked); or several
 * delegated wallets cannot be disambiguated to a single signer
 * (`AMBIGUOUS_WALLET`). Re-evaluated on every call, so a revocation takes effect
 * immediately and a stale wallet is never reused.
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
  // ── 1. The user must exist and be active (deleted/suspended/banned cannot
  // sign). A deleted user cascades its wallets, so this also catches that. ──
  const [user] = (await db
    .select({ status: users.status })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)) as { status: string }[];
  if (!user) {
    throw new EmbeddedWalletError('USER_NOT_FOUND', `user ${userId} not found`);
  }
  if (user.status !== 'active') {
    throw new EmbeddedWalletError('USER_INACTIVE', `user ${userId} is '${user.status}', not active`);
  }

  // ── 2. Ownership: only THIS user's solana wallets are ever considered. ──
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

  // ── 3. Only CURRENTLY-delegated wallets may sign. A revoked wallet has
  // `delegated = false` and is excluded here. ──
  const delegated = embedded.filter((w) => w.delegated);
  if (delegated.length === 0) {
    throw new EmbeddedWalletError(
      'NOT_DELEGATED',
      `embedded wallet for user ${userId} has not granted (or has revoked) delegated signing`,
    );
  }

  // ── 4. Deterministic, unambiguous choice. With one delegated wallet, use it.
  // With several (e.g. a replacement that did not revoke the old wallet) require
  // exactly one primary — otherwise fail closed so an old wallet can never be
  // picked by undefined row ordering. ──
  let chosen: WalletRow;
  if (delegated.length === 1) {
    chosen = delegated[0]!;
  } else {
    const primaries = delegated.filter((w) => w.isPrimary);
    if (primaries.length !== 1) {
      throw new EmbeddedWalletError(
        'AMBIGUOUS_WALLET',
        `user ${userId} has ${delegated.length} delegated embedded wallets and ${primaries.length} primary — cannot resolve a single signer`,
      );
    }
    chosen = primaries[0]!;
  }

  return { address: chosen.address, delegated: true };
}
