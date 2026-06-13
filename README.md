# RivlayX

Crypto-native objective wagering platform on Solana / USDC.

> Fase 1 MVP — under construction. No public users until safety brakes are verified.

## Stack (Fase 1)

- **FE + API:** Next.js 15 (App Router) on Vercel _(Sprint 1+)_
- **Auth + wallet:** Privy (email/social login + embedded Solana wallet)
- **Database:** Supabase Postgres (3 logical schemas: `auth`, `app`, `financial`) + Drizzle ORM
- **Storage:** Supabase Storage (evidence uploads)
- **Chain:** Solana mainnet · USDC SPL · Helius RPC + webhooks
- **Auto-resolve providers:** API-Football · CoinGecko

## Safety brakes (hard-capped Fase 1)

| Brake            | Default                  | Where enforced                           |
| ---------------- | ------------------------ | ---------------------------------------- |
| `MAX_BET_USDC`   | 25                       | Pre-check on bet create                  |
| `MAX_TVL_USDC`   | 1000                     | Pre-check on bet create + deposit credit |
| Emergency freeze | `financial.freeze_state` | Admin kill-switch per component          |

## Repo layout

```
apps/web/        Next.js app          (Sprint 1+)
packages/
  shared/        USDC constants + helpers
  db/            Drizzle schemas (auth, app, financial)
  core/          Business logic        (Sprint 2+)
workers/         Background jobs        (Sprint 3+)
tests/           E2E + integration tests
scripts/         Ops scripts
```

## Dev setup

```bash
pnpm install
pnpm db:up                  # start local Postgres
cp .env.example .env        # fill in values
pnpm typecheck
pnpm test
```

## Scripts

| Script                              | Purpose                      |
| ----------------------------------- | ---------------------------- |
| `pnpm lint` / `pnpm lint:fix`       | ESLint                       |
| `pnpm typecheck`                    | TypeScript across workspaces |
| `pnpm test` / `pnpm test:watch`     | Vitest                       |
| `pnpm format` / `pnpm format:check` | Prettier                     |
| `pnpm db:up` / `pnpm db:down`       | Local Postgres               |
