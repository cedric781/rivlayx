import { z } from 'zod';

const BaseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  MAX_BET_USDC: z.coerce.number().int().positive().default(25),
  MAX_TVL_USDC: z.coerce.number().int().positive().default(1000),
  MIN_DEPOSIT_USDC: z.coerce.number().positive().default(5),
  MAX_SINGLE_DEPOSIT_USDC: z.coerce.number().positive().default(250),
  // Withdrawal caps — same single source the admin approve route threads into
  // @rivlayx/core approveWithdrawal. Closed-alpha defaults mirror WITHDRAWAL_LIMITS.
  MAX_WITHDRAW_USDC: z.coerce.number().positive().default(25),
  MAX_DAILY_WITHDRAW_USDC: z.coerce.number().positive().default(100),
  PORT: z.coerce.number().int().positive().default(3001),
  /** First user with this email is granted super_admin via `pnpm db:seed`. */
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
  // ── C5 — admin TOTP MFA ───────────────────────────────────────────────────
  // Base64 of a 32-byte key encrypting TOTP secrets at rest. Required in
  // production; optional in dev/test (MFA verify returns a config error if a
  // verify is attempted without it). Never commit a real value.
  MFA_ENCRYPTION_KEY: z.string().optional(),
  /** Money approvals require MFA verified within this many minutes. */
  MFA_MAX_AGE_MINUTES: z.coerce.number().int().positive().default(15),
  /** Issuer label shown in the authenticator app. */
  MFA_ISSUER: z.string().default('RivlayX Admin'),
  // Placeholders for later sprints
  PRIVY_APP_ID: z.string().optional(),
  PRIVY_APP_SECRET: z.string().optional(),
});

const Schema = BaseSchema.superRefine((env, ctx) => {
  if (env.NODE_ENV === 'production' && !env.MFA_ENCRYPTION_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['MFA_ENCRYPTION_KEY'],
      message: 'required in production (admin MFA secrets-at-rest)',
    });
  }
});

export type Env = z.infer<typeof Schema>;

export function loadEnv(
  source: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): Env {
  const result = Schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables (apps/admin):\n${issues}`);
  }
  return result.data;
}

let cached: Env | null = null;
export function getEnv(): Env {
  cached ??= loadEnv();
  return cached;
}
