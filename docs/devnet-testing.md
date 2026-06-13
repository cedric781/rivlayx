# Devnet testing — Sprint 5

End-to-end manual walkthrough of the wallet + deposit UX against **Solana
devnet**. Mock Helius is still used for deposit detection (live webhook lands
in Sprint 6+). No mainnet, no real money.

---

## Prerequisites

- Docker Desktop running (for local Postgres)
- Node 20.x + pnpm 10.x
- A Privy account at https://dashboard.privy.io

## 1. Privy app setup

1. Sign in at https://dashboard.privy.io
2. Create a new app (e.g. `RivlayX Devnet`)
3. **Chains tab:** enable Solana devnet
4. **Embedded wallets tab:** enable Solana embedded wallets, "Create on login: users without wallets"
5. **Login methods:** enable Email + Google + X (optional)
6. **Settings tab:** copy `App ID` and `App Secret`

## 2. Local env

Copy `.env.example` to `.env` and fill in:

```
NODE_ENV=development
DATABASE_URL=postgresql://rivlayx:rivlayx_dev@localhost:5432/rivlayx_dev

# Privy
PRIVY_APP_ID=cm_xxx_from_dashboard
NEXT_PUBLIC_PRIVY_APP_ID=cm_xxx_from_dashboard   # same value
PRIVY_APP_SECRET=xxx_from_dashboard

# Solana
SOLANA_NETWORK=devnet
# SOLANA_RPC_URL=https://api.devnet.solana.com   # default

# Vault (pick any valid base58 Solana ATA for now — Sprint 6 will generate)
PLATFORM_VAULT_ATA=DevVaultAtaPlaceholder11111111111111111111
```

## 3. Postgres + migrations

```bash
pnpm db:up
pnpm --filter @rivlayx/db db:migrate
pnpm --filter @rivlayx/db db:seed     # creates bootstrap super_admin
```

## 4. Run the user app

```bash
pnpm --filter @rivlayx/web dev
```

Open http://localhost:3000

## 5. Sign in via Privy

1. Click **Sign in** → Privy modal opens
2. Choose email → enter your email → confirm OTP
3. Privy creates a devnet embedded Solana wallet
4. Browser redirects to `/wallet` showing:
   - Balance: `0.00 USDC` (available + locked)
   - Linked Solana wallet address (`source: privy embedded`)
   - Empty deposit history

## 6. Fund the devnet wallet

The Privy embedded wallet is brand new and has no SOL or USDC.

1. Visit https://faucet.solana.com — request 1 SOL for your wallet address (for tx fees)
2. Visit https://faucet.circle.com — request devnet USDC for your wallet address
3. (Optional) check balance via https://explorer.solana.com/address/&lt;your-address&gt;?cluster=devnet

## 7. Simulate a deposit (dev-only)

Since Sprint 5 doesn't ship the live Helius webhook handler, use the dev-only
simulator to exercise the full detect → confirm → credit pipeline:

```bash
curl -X POST http://localhost:3000/api/dev/simulate-deposit \
  -H 'Content-Type: application/json' \
  -b "rivlayx_user_session=<your-session-cookie>" \
  -d '{ "amountUsdc": 25 }'
```

Or from the browser DevTools console while on `/wallet`:

```js
await fetch('/api/dev/simulate-deposit', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ amountUsdc: 25 }),
}).then((r) => r.json());
```

Expected response:

```json
{
  "stage": "credit",
  "result": {
    "kind": "credited",
    "depositId": "...",
    "ledgerTxnId": "..."
  }
}
```

Reload `/wallet` — balance should now show **25.00 USDC available** and the
deposit should appear in history with status **Credited**.

## 8. Validate safety brakes

Try these to confirm each guard fires:

| Body                                                     | Expected response                                                     |
| -------------------------------------------------------- | --------------------------------------------------------------------- |
| `{ "amountUsdc": 1 }`                                    | `stage: detect`, `kind: deposit_rejected`, `reason: amount_too_small` |
| `{ "amountUsdc": 500 }`                                  | `stage: detect`, `kind: deposit_rejected`, `reason: amount_too_large` |
| (after TVL near 1000)                                    | `stage: detect`, `kind: deposit_rejected`, `reason: tvl_cap_exceeded` |
| Same request twice (with `signature: "fixedSig123..."`)  | second call: `kind: duplicate`                                        |
| `{ "amountUsdc": 25, "sourceWallet": "OtherWallet..." }` | `kind: orphan` (writes orphan_deposits row, no balance change)        |

## 9. Reset between runs

```bash
psql "$DATABASE_URL" -c "TRUNCATE financial.deposits, financial.orphan_deposits, financial.ledger_entries, financial.balances CASCADE;"
```

(Keep `auth.users` so you don't have to re-link Privy.)

## What this does NOT exercise (yet)

- Real Helius webhook delivery (Sprint 6)
- Real Solana RPC finality re-checks (Sprint 6)
- Vault private key + outgoing payouts (Sprint 6/10)
- Bet creation, escrow, settlement (Sprint 7+)

Live Helius webhook + cron-driven confirmer + real RPC integration come in
Sprint 6. Sprint 5's purpose is to make the _user-facing_ deposit UX feel
real, end-to-end, against devnet.
