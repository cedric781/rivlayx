# Sprint 17 — Risk Engine (Build Plan)

> Shadow mode, read-only. Implements `docs/risk-engine-design.md`. **No code is
> written until these documents are reviewed and approved.** No changes to
> deposits, escrow, settlement, payouts, balances or money flow.

## 1. Architecture

Mirrors the proven `reputation/` layout: pure scoring core, isolated read-only
gathering, self-driven cron. Only new files + one additive migration + one new
admin page.

### New core module `packages/core/src/risk/`

```
packages/core/src/risk/
  types.ts        RiskSignals, sub-scores, RiskResult, alert/band enums
  config.ts       ALL thresholds & weights (one place; tune without schema change)
  graph.ts        build/refresh counterparty graph → risk_edges, connected components
  ring.ts         pure: cohesion / repeated-cp / arbiter-overlap → ringSignal
  arbiter-concentration.ts pure: creator/acceptor/cluster arbiter share → arbiterConcentrationSignal
  concentration.ts pure: HHI over counterparties → concentrationSignal
  wash.ts         pure: round-trips / net-exposure → washSignal
  abuse.ts        pure: frivolous / excess / pattern → abuseSignal
  velocity.ts     pure: window-vs-baseline spikes → velocitySignal
  sybil.ts        pure: burst / name / stake / template similarity → sybil cluster
  funding.ts      supporting: shared source_wallet (read-only, allowlist) → fundingSignal
  score.ts        PURE: combine sub-signals → risk_score + band (design §4)
  signals.ts      gather* — DB reads → RiskSignals (read-only)
  monitor.ts      raise/refresh/dedup alerts → risk_alerts
  scanner.ts      find recently-active subjects → risk_recompute_queue
  recompute.ts    drain queue: gather → score → upsert + alerts; + full sweep
  query.ts        admin-only reads (top risk, clusters, open alerts)
  index.ts        public exports
```

**Boundaries:** every function in `risk/` is read-only against existing tables
and only writes to `app.risk_*` tables. No import from `bets/settle`,
`payouts`, escrow or balance modules. A lint/test guard asserts this (§5).

## 2. Data model

Migration **`0012_risk_engine.sql`** — **additive only** (new tables + indexes,
no `ALTER` on existing tables, no FKs from existing tables into risk tables).

### New table `app.risk_scores`

| Column | Type | Notes |
| --- | --- | --- |
| `user_id` | uuid PK | FK → `auth.users` ON DELETE cascade |
| `risk_score` | integer | CHECK 0–100 |
| `risk_band` | varchar(16) | none/low/elevated/high/critical |
| `ring_score` | integer | CHECK 0–100 |
| `arbiter_concentration_score` | integer | CHECK 0–100 |
| `concentration_score` | integer | CHECK 0–100 |
| `wash_score` | integer | CHECK 0–100 |
| `abuse_score` | integer | CHECK 0–100 |
| `velocity_score` | integer | CHECK 0–100 |
| `funding_overlap_score` | integer | CHECK 0–100 (supporting) |
| `ring_cluster_id` | uuid null | component id |
| `sybil_cluster_id` | uuid null | |
| `components` | jsonb | raw inputs / explainability |
| `computed_at` / `updated_at` | timestamptz | |

Indexes: `risk_score`, `risk_band`, `ring_cluster_id`.

### New table `app.risk_alerts`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `subject_type` | varchar(16) | `user` \| `cluster` \| `pair` |
| `subject_id` | text | user_id / cluster_id / canonical pair key |
| `type` | varchar(32) | ring/sybil/wash_trade/dispute_abuse/velocity/high_risk_user |
| `severity` | varchar(16) | band |
| `score` | integer | CHECK 0–100 |
| `evidence` | jsonb | why it fired |
| `status` | varchar(16) | open/triaged/dismissed/actioned |
| `created_at` / `updated_at` | timestamptz | |
| `resolved_at` | timestamptz null | |
| `resolved_by_user_id` | uuid null | FK → `auth.users` |

Partial unique index `(subject_type, subject_id, type) WHERE status = 'open'`
for dedup. Index on `(status, severity, created_at)` for the admin queue.

### New table `app.risk_edges` (graph cache)

| Column | Type | Notes |
| --- | --- | --- |
| `user_a` / `user_b` | uuid | canonical `user_a < user_b`; FK → users cascade |
| `shared_bets` | integer | |
| `shared_volume_usdc` | numeric(20,6) | |
| `shared_arbiter_bets` | integer | |
| `last_bet_at` | timestamptz | |
| `cluster_id` | uuid null | assigned by `graph.ts` |
| `updated_at` | timestamptz | |

Unique `(user_a, user_b)`. Indexes on `user_a`, `user_b`, `cluster_id`.

### New table `app.risk_recompute_queue` (work queue)

| Column | Type | Notes |
| --- | --- | --- |
| `subject_type` | varchar(16) | |
| `subject_id` | text | |
| `reason` | varchar(32) | scan reason |
| `enqueued_at` | timestamptz | indexed |

PK `(subject_type, subject_id)` for dedup upsert. Populated by `scanner.ts`,
**not** by money-path transactions.

### Enums (drizzle, in `db`)

`riskBandValues`, `riskAlertTypeValues`, `riskAlertStatusValues`,
`riskSubjectTypeValues`.

## 3. Migration plan

1. `pnpm db:generate` after adding the drizzle tables → produces
   `0012_risk_engine.sql` + snapshot, journal entry `0012`.
2. Verify it contains **only** `CREATE TABLE` / `CREATE INDEX` / new-FK
   statements — zero `ALTER` against existing tables.
3. Apply on a scratch DB; confirm existing 462 tests still pass unchanged.

## 4. Cron jobs (`vercel.json`)

| Path | Schedule | Purpose |
| --- | --- | --- |
| `/api/cron/risk` | `*/15 * * * *` | scan recent activity → enqueue → drain → score + alerts |
| `/api/cron/risk?full=1` | `0 4 * * *` | rebuild graph + recompute all (after reputation 03:00) |

Both wrapped in `withAdvisoryLock(CRON_LOCK_KEYS.risk, …)` (new lock key),
auth via the existing `requireCron`. No money-path cron is modified.

## 5. Test plan

Pure-unit tests per detector (crafted signals, no DB) **plus** DB-integration
fixtures, mirroring the reputation/arbiter test style.

### Detector unit tests (`*.test.ts`, pure)
- **ring**: closed 4-node cluster → high cohesion; open well-connected user →
  low. Arbiter-in-cluster raises `arbiterOverlap`.
- **arbiter concentration**: one creator routing all bets to one user-selected
  arbiter → high; platform-selected rulings excluded; spread arbiters → low;
  single ruled bet (below gate) → 0.
- **concentration**: all volume via one cp → HHI≈1; spread → low.
- **wash**: high round-trips + net≈0 + volume → high; one-off loss → low.
- **abuse**: high frivolous + disproportionate dispute count → high.
- **velocity**: 10× spike vs baseline → high; steady user → 0.
- **sybil**: creation burst + name pattern + identical stakes → one cluster.
- **score combine**: band thresholds (0/20/40/60/80) exact; funding booster
  capped at +5 and gated on primary ≥ 0.40.

### DB integration tests
- Fixtures that materialise a ring, a sybil cluster, a wash pair, a dispute
  abuser, a velocity spike → assert correct `risk_scores`, bands and alerts.
- Alert dedup: re-running the scan does not duplicate open alerts.

### False-positive fixtures (must score `none`/`low`)
- **legit whale**: high volume across many distinct counterparties.
- **shared exchange wallet**: many unrelated users, same `source_wallet` on the
  allowlist → funding signal excluded → no alert.
- **family pair**: two users, shared funding, a few low-stake bets → below ring
  gate → no alert.
- **new-user onboarding burst**: high early activity, no baseline → no velocity
  alert, capped at `low`.

### Isolation guard
- A test asserting a full risk recompute mutates **no** rows in `bets`,
  `balances`, `settlements`, `payouts`, `deposits` (only `app.risk_*`).

## 6. Admin tooling

New page **`apps/admin/app/(authed)/risk/page.tsx`** (`/admin/risk`), read-only,
behind the existing authed admin shell. Add nav entry in `admin-shell.tsx`.

Panels:
- **Open alerts** queue (sortable by severity, filter by type, triage actions:
  mark triaged / dismissed / actioned — status only, no money action).
- **Top risk users** (by `risk_score`, band badge).
- **Ring clusters** (members, cohesion, shared volume).
- **Sybil clusters** (members, confidence, signals hit).
- **Wash-trade alerts** (pair, round-trips, net exposure).
- **Dispute-abuse alerts** (frivolous rate, dispute count).

All reads via `risk/query.ts`. No score/cluster data is exposed outside the
admin app.

## 7. Rollout plan

1. **Migration 0012** (additive, zero-downtime).
2. **Engine + cron in shadow mode** — compute scores + raise alerts only. No
   user-visible effect anywhere.
3. **Backfill** — run `/api/cron/risk?full=1` once post-deploy to build the
   graph and score existing users.
4. **Observe** — T&S triages alerts via `/admin/risk` for several weeks;
   dismissed/actioned outcomes feed a per-detector precision metric.
5. **Tune** — adjust `config.ts` thresholds to hit the target false-positive
   rate. No schema change required.
6. **Future sprint (out of scope here)** — only once precision is acceptable,
   consider wiring enforcement hooks. That is a separate, explicit decision.

## 8. Out of scope (this sprint)

- Automatic enforcement of any kind.
- Any change to deposits / escrow / settlement / payouts / balances / money flow.
- Device fingerprinting, IP tracking, KYC.
- ML models.
- Public exposure of risk signals.
