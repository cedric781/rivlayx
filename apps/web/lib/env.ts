import { z } from 'zod';

const BaseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  MAX_BET_USDC: z.coerce.number().int().positive().default(25),
  MAX_TVL_USDC: z.coerce.number().int().positive().default(1000),
  MIN_DEPOSIT_USDC: z.coerce.number().positive().default(5),
  MAX_SINGLE_DEPOSIT_USDC: z.coerce.number().positive().default(250),
  PORT: z.coerce.number().int().positive().default(3000),
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
