// ─────────────────────────────────────────────────────────────────────────────
// Transfer signer selector (Phase 4 wiring — flag-gated, NOT a cutover).
// `buildTransferProvider` is the single place that picks a signer. Exactly ONE
// backend is active per deploy, chosen by `PAYMENT_BACKEND` (default raw-vault);
// raw-vault and Privy never run side by side. The Privy path stays GATED until
// the delegated signer is injected at cutover (see payment-cleanup audit).
// ─────────────────────────────────────────────────────────────────────────────
import { payouts } from '@rivlayx/core';
import { USDC_MINT_ADDRESS } from '@rivlayx/shared';
import { getEnv, type Env } from '../env';
import { runShadow } from './shadow';

/** Solana system-program id — placeholder fee payer for the gated privy path. */
const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';

export interface BuildTransferProviderDeps {
  /** Override the resolved env (tests). */
  env?: Env;
  /**
   * Delegated Privy signer. Injected by tests and (later) at cutover. Omitted
   * pre-cutover → the privy provider is assembled GATED and signs nothing.
   */
  privySigner?: payouts.PrivySolanaSigner;
}

/**
 * Gated delegated signer: rejects every signing attempt permanently. Used when
 * PAYMENT_BACKEND=privy is selected before a real signer is wired — it mirrors
 * the mainnet-beta raw-vault gate (returned provider fails permanently). In
 * practice the empty-allowlist policy denies first, so this is a second guard.
 */
const GATED_PRIVY_SIGNER: payouts.PrivySolanaSigner = {
  signAndSend() {
    return Promise.reject(
      new payouts.TransferPermanentError('privy delegated signer not wired (cutover step)'),
    );
  },
};

/** Assemble the already-built Privy provider from env + an (optional) signer. */
function buildPrivyTransferProvider(
  env: Env,
  signer?: payouts.PrivySolanaSigner,
): payouts.SolanaTransferProvider {
  const usdcMint = env.SOLANA_USDC_MINT ?? USDC_MINT_ADDRESS;
  const caip2 =
    env.SOLANA_NETWORK === 'mainnet-beta'
      ? payouts.SOLANA_CAIP2.mainnet
      : payouts.SOLANA_CAIP2.devnet;
  const policy: payouts.PrivyTransferPolicy = {
    usdcMint,
    // Empty allowlist until the escrow wallet is configured → every transfer is
    // denied permanently (gated). Cutover sets ESCROW_WALLET to open the path.
    allowedDestinations: env.ESCROW_WALLET ? [env.ESCROW_WALLET] : [],
    maxAmountUsdc: String(env.MAX_BET_USDC),
  };
  return new payouts.PrivySolanaTransferProvider({
    signer: signer ?? GATED_PRIVY_SIGNER,
    policy,
    caip2,
    feePayer: env.SOLANA_RELAYER_PUBKEY ?? SYSTEM_PROGRAM_ID,
  });
}

/**
 * Pure backend selection (exported for tests). Off-production always returns the
 * deterministic mock — no real signer runs outside production, regardless of the
 * flag. In production it branches on PAYMENT_BACKEND.
 */
export function selectProvider(
  env: Env,
  privySigner?: payouts.PrivySolanaSigner,
): payouts.SolanaTransferProvider {
  if (env.NODE_ENV !== 'production') {
    return new payouts.MockSolanaTransferProvider();
  }

  if (env.PAYMENT_BACKEND === 'privy') {
    return buildPrivyTransferProvider(env, privySigner);
  }

  // ── raw-vault (default) — exact current behavior, unchanged. ──
  if (env.SOLANA_NETWORK === 'mainnet-beta') {
    // No signer plumbed for mainnet → any attempt fails permanently (not_configured).
    return new payouts.DevnetSolanaTransferProvider({ rpcUrl: '', usdcMint: '' });
  }
  return new payouts.DevnetSolanaTransferProvider({
    rpcUrl: env.SOLANA_RPC_URL ?? '',
    vaultSecretKeyBase58: env.SOLANA_VAULT_SECRET_KEY,
    usdcMint: env.SOLANA_USDC_MINT ?? USDC_MINT_ADDRESS,
    commitment: 'confirmed',
  });
}

/**
 * Transparent observability decorator. Logs each transfer attempt + outcome
 * (reference, idempotency key = reference, duration, provider) without altering
 * behavior: same result, same errors, same `name`. Never logs secrets or amounts.
 */
class LoggingTransferProvider implements payouts.SolanaTransferProvider {
  constructor(
    private readonly inner: payouts.SolanaTransferProvider,
    private readonly backend: string,
  ) {}

  get name(): string {
    return this.inner.name;
  }

  async buildAndSubmitTransfer(
    input: payouts.TransferInput,
  ): Promise<payouts.TransferResult> {
    const startedAt = Date.now();
    const base = {
      provider: this.inner.name,
      backend: this.backend,
      reference: input.reference,
      idempotencyKey: input.reference,
      betId: input.betId,
    };
    try {
      const result = await this.inner.buildAndSubmitTransfer(input);
      console.info(
        JSON.stringify({ event: 'transfer_ok', ...base, durationMs: Date.now() - startedAt }),
      );
      return result;
    } catch (err) {
      console.warn(
        JSON.stringify({
          event: 'transfer_failed',
          ...base,
          durationMs: Date.now() - startedAt,
          error: err instanceof Error ? err.name : 'unknown',
        }),
      );
      throw err;
    }
  }
}

/**
 * Shadow decorator (Phase 5). Runs the live (raw-vault) transfer UNCHANGED, then
 * computes + compares the Privy dry-run intent for observability. The shadow pass
 * runs in `finally` and can never alter the live result or error: it returns the
 * inner result verbatim and re-throws the inner error untouched. It performs no
 * signing, no RPC, no writes (see `runShadow`).
 */
class ShadowTransferProvider implements payouts.SolanaTransferProvider {
  constructor(
    private readonly inner: payouts.SolanaTransferProvider,
    private readonly env: Env,
  ) {}

  get name(): string {
    return this.inner.name;
  }

  async buildAndSubmitTransfer(
    input: payouts.TransferInput,
  ): Promise<payouts.TransferResult> {
    try {
      return await this.inner.buildAndSubmitTransfer(input);
    } finally {
      try {
        runShadow(input, { env: this.env, providerName: this.inner.name });
      } catch {
        // Shadow is observability-only — never let it affect the live path.
      }
    }
  }
}

/**
 * Wrap `inner` in the shadow decorator when shadow mode is on against the live
 * raw-vault backend; otherwise return `inner` unchanged. Shadowing the privy
 * backend (when it is itself live) would compare it to itself — skipped.
 * Exported so the transparency property is directly testable.
 */
export function maybeWrapShadow(
  inner: payouts.SolanaTransferProvider,
  env: Env,
): payouts.SolanaTransferProvider {
  if (env.PAYMENT_SHADOW_MODE && env.PAYMENT_BACKEND === 'raw-vault') {
    return new ShadowTransferProvider(inner, env);
  }
  return inner;
}

/**
 * Resolve the Solana transfer provider used by the withdrawal + payout runners.
 * Selects the backend via PAYMENT_BACKEND (default raw-vault) and wraps it in a
 * transparent logging decorator. When PAYMENT_SHADOW_MODE=true with the raw-vault
 * backend, also wraps it in the shadow decorator (dry-run Privy comparison).
 * `deps` is injectable for tests/cutover.
 */
export function buildTransferProvider(
  deps: BuildTransferProviderDeps = {},
): payouts.SolanaTransferProvider {
  const env = deps.env ?? getEnv();
  const provider = selectProvider(env, deps.privySigner);
  console.info(
    JSON.stringify({
      event: 'transfer_provider_selected',
      backend: env.PAYMENT_BACKEND,
      provider: provider.name,
      shadow: env.PAYMENT_SHADOW_MODE,
    }),
  );

  const logged: payouts.SolanaTransferProvider = new LoggingTransferProvider(
    provider,
    env.PAYMENT_BACKEND,
  );
  return maybeWrapShadow(logged, env);
}
