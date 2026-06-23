import { payouts } from '@rivlayx/core';

/**
 * Privy delegated-signing adapter (Phase 2). Structurally implements the core
 * `PrivySolanaSigner` port via Privy's server `walletApi.solana.signAndSendTransaction`.
 *
 * NOT WIRED to any money flow in Phase 2 — constructed/tested in isolation.
 *
 * Kept behind a narrow injected client (the repo's `PrivyClientLike` pattern):
 * tests pass a stub; production passes the real `PrivyClient`. This keeps the
 * `@solana/web3.js` transaction object opaque (built in core) and out of
 * `apps/web`, which does not depend on web3.js directly.
 *
 * The request/result types are declared locally (the core port types are not
 * yet part of `@rivlayx/core`'s public surface); they are structurally
 * compatible with the core `PrivySolanaSigner`, so wiring the adapter into
 * `PrivySolanaTransferProvider` in a later phase type-checks without change.
 */
export interface PrivySignAndSendRequest {
  fromWallet: string;
  caip2: string;
  idempotencyKey: string;
  /** Opaque web3.js transaction built in core; forwarded as-is to Privy. */
  transaction: unknown;
}

export interface PrivySignAndSendResult {
  txSignature: string;
}

/** Narrow surface of Privy's wallet API that this adapter uses. */
export interface PrivySolanaWalletApiLike {
  walletApi: {
    solana: {
      signAndSendTransaction(input: {
        address: string;
        chainType: 'solana';
        caip2: string;
        transaction: unknown;
        idempotencyKey?: string;
      }): Promise<{ signature?: string; hash?: string }>;
    };
  };
}

export class PrivyServerSolanaSigner {
  constructor(private readonly client: PrivySolanaWalletApiLike) {}

  async signAndSend(req: PrivySignAndSendRequest): Promise<PrivySignAndSendResult> {
    let res: { signature?: string; hash?: string };
    try {
      res = await this.client.walletApi.solana.signAndSendTransaction({
        address: req.fromWallet,
        chainType: 'solana',
        caip2: req.caip2,
        transaction: req.transaction,
        idempotencyKey: req.idempotencyKey,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Bad input / policy denial / blacklist → permanent; everything else
      // (RPC, timeout, rate limit, node behind) → retryable.
      if (isPermanentSignerError(message)) {
        throw new payouts.TransferPermanentError(message);
      }
      throw new payouts.TransferRetryableError(message);
    }

    const txSignature = res.signature ?? res.hash;
    if (!txSignature) {
      // No signature returned is non-deterministic — treat as retryable.
      throw new payouts.TransferRetryableError('Privy returned no transaction signature');
    }
    return { txSignature };
  }
}

const PERMANENT_HINTS = [
  'policy',
  'denied',
  'not allowed',
  'invalid',
  'blacklist',
  'insufficient',
  'unauthorized',
];

function isPermanentSignerError(message: string): boolean {
  const m = message.toLowerCase();
  return PERMANENT_HINTS.some((h) => m.includes(h));
}
