import { payouts } from '@rivlayx/core';
import { USDC_MINT_ADDRESS } from '@rivlayx/shared';
import type { Env } from '../env';

/**
 * Shadow Mode (Phase 5). When PAYMENT_SHADOW_MODE=true the live raw-vault flow
 * stays fully active; alongside each transfer we compute what the Privy path
 * WOULD do — as a pure DRY-RUN — and compare. It NEVER signs, submits, calls an
 * RPC, writes the ledger, or changes a bet: it only computes, compares, logs and
 * counts. The Privy foundation's `prepare*` writers are deliberately NOT called
 * (they persist a row); this module mirrors their intent without the write.
 */

export type ShadowTransferType = 'stake' | 'settlement_payout' | 'withdrawal';

/** The seven compared dimensions of a transfer intent. */
export interface ShadowTransferIntent {
  type: ShadowTransferType;
  amountUsdc: string;
  source: string;
  destination: string;
  mint: string;
  caip2: string;
  idempotencyKey: string;
}

export interface ShadowOutcome {
  status: 'success' | 'difference' | 'failed' | 'skipped';
  type?: ShadowTransferType;
  /** Names of the intent fields that differed (empty on success/skip/fail). */
  differences: string[];
}

export interface ShadowMetricsSnapshot {
  shadow_success: number;
  shadow_failure: number;
  shadow_difference: number;
  shadow_skipped: number;
}

// ── Metrics: a process-local tally, logged per run. Reset between tests. ──
const metrics: ShadowMetricsSnapshot = {
  shadow_success: 0,
  shadow_failure: 0,
  shadow_difference: 0,
  shadow_skipped: 0,
};
export function shadowMetrics(): ShadowMetricsSnapshot {
  return { ...metrics };
}
export function resetShadowMetrics(): void {
  metrics.shadow_success = 0;
  metrics.shadow_failure = 0;
  metrics.shadow_difference = 0;
  metrics.shadow_skipped = 0;
}

/** Recover the logical transfer type from the reference/idempotency key prefix. */
function inferType(reference: string): ShadowTransferType {
  if (reference.startsWith('stake:')) return 'stake';
  if (reference.startsWith('payout:')) return 'settlement_payout';
  if (reference.startsWith('withdrawal:')) return 'withdrawal';
  // The raw-vault withdrawal runner uses a bare requestId as the reference.
  return 'withdrawal';
}

/** Privy's idempotency-key scheme (mirrors the escrow `prepare*` foundations). */
function privyIdempotencyKey(type: ShadowTransferType, reference: string): string {
  const prefix = type === 'settlement_payout' ? 'payout' : type;
  return reference.startsWith(`${prefix}:`) ? reference : `${prefix}:${reference}`;
}

interface ShadowConfig {
  mint: string;
  caip2: string;
  platformVault: string;
  escrowWallet: string;
}

function configFromEnv(env: Env): ShadowConfig {
  return {
    mint: env.SOLANA_USDC_MINT ?? USDC_MINT_ADDRESS,
    caip2:
      env.SOLANA_NETWORK === 'mainnet-beta'
        ? payouts.SOLANA_CAIP2.mainnet
        : payouts.SOLANA_CAIP2.devnet,
    // Readable sentinels for wallets the decorator does not carry. The raw-vault
    // custodial flow signs from the platform vault; Privy signs from the user's
    // embedded wallet (or escrow for payouts) — a difference shadow surfaces.
    platformVault: env.PLATFORM_VAULT_ATA ?? '(raw-vault: platform vault)',
    escrowWallet: env.ESCROW_WALLET ?? '(privy: escrow wallet)',
  };
}

/** Intent the live raw-vault transfer represents (custodial: signs from the vault). */
function planRawVaultIntent(
  input: payouts.TransferInput,
  type: ShadowTransferType,
  cfg: ShadowConfig,
): ShadowTransferIntent {
  return {
    type,
    amountUsdc: input.amountUsdc,
    source: input.fromWallet ?? cfg.platformVault,
    destination: input.toWallet,
    mint: cfg.mint,
    caip2: cfg.caip2,
    idempotencyKey: input.reference,
  };
}

/** Intent the Privy path WOULD build for the same transfer (dry-run; no persist). */
function planPrivyIntent(
  input: payouts.TransferInput,
  type: ShadowTransferType,
  cfg: ShadowConfig,
): ShadowTransferIntent {
  const source =
    type === 'settlement_payout'
      ? cfg.escrowWallet
      : (input.fromWallet ?? '(privy: user embedded wallet)');
  return {
    type,
    amountUsdc: input.amountUsdc,
    source,
    destination: input.toWallet,
    mint: cfg.mint,
    caip2: cfg.caip2,
    idempotencyKey: privyIdempotencyKey(type, input.reference),
  };
}

/** Field-by-field diff of the two intents — returns the differing field names. */
export function compareIntents(
  actual: ShadowTransferIntent,
  shadow: ShadowTransferIntent,
): string[] {
  const fields: (keyof ShadowTransferIntent)[] = [
    'type',
    'amountUsdc',
    'source',
    'destination',
    'mint',
    'caip2',
    'idempotencyKey',
  ];
  return fields.filter((f) => actual[f] !== shadow[f]);
}

export interface RunShadowContext {
  env: Env;
  /** Active (raw-vault) provider name, for log attribution. */
  providerName: string;
}

/**
 * Run one shadow comparison. Pure + synchronous: no DB, no signer, no RPC, no
 * network — so it can neither move money nor write state. Never throws; failures
 * are caught, counted and logged. Returns the outcome (for metrics/tests).
 */
export function runShadow(
  input: payouts.TransferInput,
  ctx: RunShadowContext,
): ShadowOutcome {
  const startedAt = Date.now();

  if (!input.reference || !input.toWallet || !input.amountUsdc) {
    metrics.shadow_skipped += 1;
    return { status: 'skipped', differences: [] };
  }

  const type = inferType(input.reference);
  const logBase = { provider: ctx.providerName, reference: input.reference, type };
  console.info(JSON.stringify({ event: 'shadow_start', ...logBase }));

  try {
    const cfg = configFromEnv(ctx.env);
    const actual = planRawVaultIntent(input, type, cfg);
    const shadow = planPrivyIntent(input, type, cfg);
    const differences = compareIntents(actual, shadow);
    const durationMs = Date.now() - startedAt;

    if (differences.length > 0) {
      metrics.shadow_difference += 1;
      console.warn(
        JSON.stringify({ event: 'shadow_difference', ...logBase, durationMs, differences }),
      );
      return { status: 'difference', type, differences };
    }

    metrics.shadow_success += 1;
    console.info(JSON.stringify({ event: 'shadow_success', ...logBase, durationMs }));
    return { status: 'success', type, differences: [] };
  } catch (err) {
    metrics.shadow_failure += 1;
    console.warn(
      JSON.stringify({
        event: 'shadow_failed',
        ...logBase,
        durationMs: Date.now() - startedAt,
        error: err instanceof Error ? err.name : 'unknown',
      }),
    );
    return { status: 'failed', type, differences: [] };
  }
}
