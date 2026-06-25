import { z } from 'zod';

const BaseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  MAX_BET_USDC: z.coerce.number().int().positive().default(25),
  MAX_TVL_USDC: z.coerce.number().int().positive().default(1000),
  MIN_DEPOSIT_USDC: z.coerce.number().positive().default(5),
  MAX_SINGLE_DEPOSIT_USDC: z.coerce.number().positive().default(250),
  // Withdrawal caps — single source consumed by request + approve + runner via
  // @rivlayx/core WithdrawalLimits. Closed-alpha defaults mirror WITHDRAWAL_LIMITS.
  MAX_WITHDRAW_USDC: z.coerce.number().positive().default(25),
  MAX_DAILY_WITHDRAW_USDC: z.coerce.number().positive().default(100),
  PORT: z.coerce.number().int().positive().default(3000),
  /**
   * Privy payment migration (Phase 4 wiring) — selects the transfer signer
   * backend. `raw-vault` (default) keeps exact current behavior; `privy` selects
   * the already-built delegated-signing provider. An unknown value is rejected
   * at boot. This is a flag only — NOT a production cutover; the default never
   * changes here.
   */
  PAYMENT_BACKEND: z.enum(['raw-vault', 'privy']).default('raw-vault'),
  /**
   * Privy payment migration (Phase 5) — shadow mode. When `true` AND
   * PAYMENT_BACKEND=raw-vault, the Privy transfer intent is computed as a DRY-RUN
   * alongside each live raw-vault transfer and compared (no signer, no RPC, no
   * submit, no writes). Pure observability. Default `false`. Parsed from the
   * literal strings `'true'`/`'false'` (an unknown value is rejected at boot) so
   * `'false'` can never coerce to truthy.
   */
  PAYMENT_SHADOW_MODE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /**
   * Central escrow wallet owner address (base58). Allowlisted stake destination
   * for the Privy provider's transfer policy. Optional: only consumed when
   * PAYMENT_BACKEND=privy; absent → the privy provider stays gated.
   */
  ESCROW_WALLET: z.string().min(32).max(64).optional(),
  /**
   * Relayer pubkey (base58) set as the Privy transfer fee payer (pays SOL, never
   * the authority). Optional: only consumed when PAYMENT_BACKEND=privy.
   */
  SOLANA_RELAYER_PUBKEY: z.string().min(32).max(64).optional(),
  /**
   * Public USDC ATA of the central escrow wallet. Read-only input to the escrow
   * reconciliation cron leg (parallels PLATFORM_VAULT_ATA for the deposit vault).
   * Only the public address — never a private key. Absent → escrow recon leg is
   * skipped.
   */
  ESCROW_VAULT_ATA: z.string().min(32).max(64).optional(),
  // Privy — required in production (real flow). Optional in dev/test so mock provider works.
  PRIVY_APP_ID: z.string().optional(),
  NEXT_PUBLIC_PRIVY_APP_ID: z.string().optional(),
  PRIVY_APP_SECRET: z.string().optional(),
  // Solana
  SOLANA_NETWORK: z.enum(['devnet', 'mainnet-beta']).default('devnet'),
  SOLANA_RPC_URL: z.string().url().optional(),
  /**
   * Public USDC ATA for the platform vault. Displayed to users on the deposit
   * page. Only the public address — never the private key.
   */
  PLATFORM_VAULT_ATA: z.string().min(32).max(64).optional(),
  /**
   * Sprint 31 — base58-encoded vault SECRET key used to sign withdrawal payouts
   * on devnet. Secret: never displayed, never logged. Optional so dev/test runs
   * (mock provider) and unconfigured prod don't fail boot; the withdrawal runner
   * surfaces a permanent failure if a payout is attempted without it.
   */
  SOLANA_VAULT_SECRET_KEY: z.string().optional(),
  /**
   * Sprint 31 — USDC SPL mint for payouts. Devnet's USDC mint differs from
   * mainnet; falls back to the canonical mainnet mint when unset.
   */
  SOLANA_USDC_MINT: z.string().min(32).max(64).optional(),
  // Sprint 6+ placeholders
  HELIUS_API_KEY: z.string().optional(),
  HELIUS_WEBHOOK_SECRET: z.string().optional(),
  // Sprint 12a — cron auth (Vercel Cron bearer) + auto-resolve provider keys.
  // CRON_SECRET required in production; cron routes refuse to run open.
  CRON_SECRET: z.string().min(16).optional(),
  API_FOOTBALL_KEY: z.string().optional(),
  COINGECKO_API_KEY: z.string().optional(),
  // Sprint 24 (G4) — dedicated read-only token for the deep health endpoint, so
  // monitoring vendors never need CRON_SECRET. Optional: /api/ops/health also
  // accepts the cron secret for internal callers.
  OPS_HEALTH_TOKEN: z.string().min(16).optional(),
  // Sprint 24 (G5) — public base URL used to build absolute runbook links in the
  // dispatched ops-alert webhook. Optional: falls back to the relative path.
  OPS_PUBLIC_BASE_URL: z.string().url().optional(),
});

const Schema = BaseSchema.superRefine((env, ctx) => {
  if (env.NODE_ENV === 'production') {
    if (!env.PRIVY_APP_ID) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PRIVY_APP_ID'],
        message: 'required in production',
      });
    }
    if (!env.NEXT_PUBLIC_PRIVY_APP_ID) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['NEXT_PUBLIC_PRIVY_APP_ID'],
        message: 'required in production (for client provider)',
      });
    }
    if (!env.PRIVY_APP_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PRIVY_APP_SECRET'],
        message: 'required in production',
      });
    }
    if (!env.PLATFORM_VAULT_ATA) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PLATFORM_VAULT_ATA'],
        message: 'required in production',
      });
    }
    if (!env.CRON_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CRON_SECRET'],
        message: 'required in production (cron routes refuse to run without it)',
      });
    }
    if (!env.SOLANA_USDC_MINT) {
      // The real payout provider only runs in production. Without an explicit
      // mint it falls back to the mainnet USDC mint — wrong (and unsafe) on a
      // devnet deploy. Force an explicit value so the network can never mismatch.
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SOLANA_USDC_MINT'],
        message: 'required in production (prevents fallback to the mainnet USDC mint on a devnet deploy)',
      });
    }
  }
});

export type Env = z.infer<typeof BaseSchema>;

export function loadEnv(
  source: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): Env {
  const result = Schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables (apps/web):\n${issues}`);
  }
  return result.data;
}

let cached: Env | null = null;
export function getEnv(): Env {
  cached ??= loadEnv();
  return cached;
}
