# Sprint 15 — Reputation System (Build Plan)

> Status: **plan / awaiting review**. No code yet.
> Companion to `docs/reputation-design.md` (model + decisions, all locked).
> v1 inputs: distinct counterparties · completed bets · settled volume ·
> account age · dispute integrity · win-rate (≤5%). **No net deposits in v1.**

---

## 1. Architecture

A new self-contained core domain feeds a single materialised snapshot table that
every consumer reads. **The money-path never computes reputation.** It only
performs a cheap, in-transaction **enqueue** (transactional outbox); a separate
worker drains the queue and does the heavy aggregation out-of-band.

> **Hard rule:** settlement / dispute ruling / moderation must NEVER depend on
> reputation computation. They `enqueue` (one tiny insert in their own
> transaction) and commit. Recompute happens later, in the worker. A reputation
> bug or slowdown can never break or delay the money-path.

```
                 ┌─────────────────────────────────────────┐
   money-path    │ settleBet · ruleDispute · suspend/ban/   │
   (engine, tx)  │ reinstate                                │
                 └───────────────┬─────────────────────────┘
                                 │ enqueueReputationRefresh(tx, userId)   ← tiny insert, IN the money tx
                                 ▼   (then COMMIT — money-path done)
                       app.reputation_recompute_queue   (outbox: 1 pending row / user)
                                 │ drained by ↓
   worker cron   ──────────────▶ runReputationWorker(db): for each queued user →
   (frequent)                    gatherSignals → computeReputation (pure) → upsert → dequeue
   nightly cron  ──────────────▶ runReputationCycle(full): backfill / safety sweep
                                 │
                                 ▼
                       app.user_reputation  (snapshot: score, tier, components)
                                 │ getReputation(db, userId)
        ┌────────────────────────┼───────────────────────────┐
        ▼                        ▼                            ▼
   Profiles (tier badge)   Marketplace (tier badge)   T&S / future Leaderboard
                                                       (score + components, internal)
```

### New core module `packages/core/src/reputation/`

| File | Responsibility |
| --- | --- |
| `config.ts` | weights, targets, caps, tier bands, provisional thresholds (single source of tuning constants) |
| `types.ts` | `ReputationSignals`, `ReputationResult`, `ReputationComponents`, `ReputationTier` |
| `signals.ts` | `gatherReputationSignals(db, userId)` — all aggregations |
| `score.ts` | `computeReputation(signals, config?)` — **pure, no DB**, fully unit-tested |
| `queue.ts` | `enqueueReputationRefresh(tx, userId, reason)` — tiny upsert into the outbox, called **inside** the money-path tx; `drainReputationQueue(db, limit)` — worker side |
| `recompute.ts` | `recomputeUserReputation(db, userId)` = gather → score → upsert snapshot; `runReputationWorker(db, opts)` = drain queue; `runReputationCycle(db, {full})` = backfill / nightly sweep |
| `query.ts` | `getReputation(db, userId)` / `getReputationMany(db, userIds[])` — read snapshot, return provisional default when no row |
| `index.ts` | exports; wired into `core/src/index.ts` as `export * as reputation` |

Design rules:
- **Money-path only enqueues.** `enqueueReputationRefresh` is a single
  `INSERT … ON CONFLICT (user_id) DO UPDATE` — atomic with the settlement/ruling,
  no aggregation, no score math. If reputation is broken, the enqueue still costs
  nothing and the money-path commits normally.
- `computeReputation` is **pure** (signals in → result out). All fraud-resistance
  is provable in unit tests with synthetic signals.
- `getReputation` **never throws on missing row** — returns a provisional "New"
  default so consumers work before/independent of backfill.
- The **worker** recompute is isolated per user (one user's failure does not
  block the rest); the nightly full sweep reconciles anything missed.

---

## 2. Data model

### New table `app.user_reputation`

| Column | Type | Notes |
| --- | --- | --- |
| `user_id` | uuid PK → `auth.users` (cascade) | one row per user |
| `score` | integer NOT NULL default 0 | 0–100, CHECK `score BETWEEN 0 AND 100` |
| `tier` | varchar(16) NOT NULL, enum | `new`/`untrusted`/`bronze`/`silver`/`gold`/`trusted` |
| `provisional` | boolean NOT NULL default true | true ⇒ public shows "New" |
| `components` | jsonb NOT NULL | raw signals + sub-scores + `winRateAnomaly` (internal) |
| `computed_at` | timestamptz NOT NULL default now() | last recompute |
| `updated_at` | timestamptz NOT NULL default now() | |

Indexes: PK(`user_id`); `idx_user_reputation_score` on (`score` desc) for the
future leaderboard; optional `idx_user_reputation_tier`.

### New table `app.reputation_recompute_queue` (outbox)

| Column | Type | Notes |
| --- | --- | --- |
| `user_id` | uuid PK → `auth.users` (cascade) | **one pending row per user** (dedupe) |
| `reason` | varchar(32) NOT NULL | `settlement`/`dispute_ruling`/`suspension`/`ban`/`reinstate`/`backfill` |
| `enqueued_at` | timestamptz NOT NULL default now() | for FIFO-ish draining |

- Enqueue = `INSERT … ON CONFLICT (user_id) DO UPDATE SET reason=…, enqueued_at=now()`
  → repeated triggers collapse to one pending refresh.
- Worker drains with `SELECT … ORDER BY enqueued_at LIMIT n FOR UPDATE SKIP LOCKED`,
  recomputes each, then `DELETE` the processed rows (only if still unchanged).
- Index: PK(`user_id`); `idx_reputation_queue_enqueued` on (`enqueued_at`).

### Enum

`reputationTierValues = ['new','untrusted','bronze','silver','gold','trusted']`
in `schema/app.ts` (varchar enum, same pattern as `betStatusValues`).

### TypeScript shapes (in `reputation/types.ts`)

```
ReputationSignals {
  distinctCounterparties: number
  completedBets: number
  matchedBets: number
  cappedSettledVolumeUsdc: string
  ageDays: number
  wins: number; losses: number
  frivolousDisputes: number; adverseDisputes: number
  status: 'active' | 'suspended' | 'banned' | 'deleted'
}
ReputationComponents {
  exp:number; comp:number; vol:number; age:number; win:number
  positive:number; integrity:number; winRateAnomaly:boolean
  signals: ReputationSignals
}
ReputationResult { score:number; tier:ReputationTier; provisional:boolean; components:ReputationComponents }
```

### Signal queries (`signals.ts`) — all over existing indexed columns

- **distinctCounterparties**: distinct "other participant" across the user's
  matched bets — `COUNT(DISTINCT other_user_id)` from `bet_participants` self-join
  (or from `bets` creator/acceptor pairing) where the user participated and
  `acceptor_user_id IS NOT NULL`.
- **completedBets / matchedBets**: counts over `bets` joined `bet_participants`
  (completed = status ∈ {SETTLED,PAID}; matched = acceptor present).
- **cappedSettledVolume**: `SUM(LEAST(per_cp_stake, 100))` — computed as a
  grouped subquery: per counterparty, the user's settled stake capped at 100,
  then summed. (One grouped query.)
- **ageDays**: `users.created_at`.
- **wins/losses**: from `settlements` (winner/loser = user). (Reuse the logic
  already in `profiles/stats.ts`.)
- **frivolousDisputes**: `disputes` where `opener_user_id = user AND status='rejected'`.
- **adverseDisputes**: `disputes` where `status='upheld' AND user participated AND user <> claimed_winner_user_id`.
- **status**: `users.status`.

---

## 3. Migration plan

- **0010_*.sql** (via `drizzle-kit generate` with a dummy `DATABASE_URL`, same as
  Sprint 14): `CREATE TABLE app.user_reputation` + `app.reputation_recompute_queue`
  + enum check + indexes.
  - **No data backfill in SQL** — both tables start empty; `getReputation`
    returns a provisional default for users without a row, so the system is safe
    immediately.
  - Snapshot/journal committed alongside (`meta/0010_snapshot.json`, `_journal.json`).
- **One-off backfill** after deploy: run `runReputationCycle(db, { full:true })`
  once (via the cron route or a `pnpm db:reputation:backfill` script) to populate
  every active user. Idempotent — safe to re-run.
- Additive & reversible: dropping the table or hiding the UI fully disables the
  feature without touching other tables.

---

## 4. Cron jobs

- **New**: `GET /api/cron/reputation` → `apps/web/app/api/cron/reputation/route.ts`.
  - Auth via existing `requireCron` (cron secret), `dynamic='force-dynamic'`.
  - Guarded by the existing `advisory-lock` helper (one runner at a time),
    mirroring the settle/auto-resolve crons.
  - Default mode: **drain the queue** — `runReputationWorker(db, {limit})`
    processes the outbox (this is the "worker" that does the actual recompute).
  - `?full=1` mode: `runReputationCycle(db, {full:true})` — nightly safety sweep
    + one-off backfill (recompute every active user regardless of queue).
- **Schedule** (`vercel.json`): a frequent **drain** (e.g. every minute,
  `* * * * *`, low-latency worker) + a nightly **full sweep**
  (`0 3 * * *` with `?full=1`), alongside the existing settle/auto-resolve/recon
  schedules.

---

## 5. Event hooks

Each calls `enqueueReputationRefresh(tx, userId, reason)` **inside** the
state-changing transaction — a single dedup upsert into the outbox. **No
recompute on the money-path.**

| Trigger | Location | Users enqueued |
| --- | --- | --- |
| Settlement | `core/src/bets/settle.ts` (`settleBet`) | creator + acceptor (both participants) |
| Dispute ruling | `core/src/bets/dispute.ts` (`ruleDispute`) | opener + the counterpart participant |
| Suspend / Ban / Reinstate | `core/src/admin/moderation.ts` | the affected user |

Notes:
- The enqueue is **part of the money-path transaction**, so a refresh is
  scheduled iff the settlement/ruling commits (transactional outbox — no lost or
  phantom refreshes). It performs zero aggregation.
- The actual recompute runs later in the **worker cron** (queue drain). A
  reputation failure or slowdown can never affect or delay the money-path.
- `withdrawDispute` → no enqueue (withdrawn disputes are forgiven; they don't
  change any scored input).
- Nightly full sweep is the safety net if an enqueue is somehow missed.

---

## 6. APIs

- **No new public REST endpoint.** Tier is rendered server-side: pages call
  `reputation.getReputation(db, userId)` directly (same SSR pattern as profiles).
- **Cron route** `/api/cron/reputation` (internal, secret-authed) — §4.
- **Admin (optional, can defer)**: an admin-app read showing full score +
  `components` for T&S review. Marked optional for this sprint.

---

## 7. Profile components changed

- **New shared** `apps/web/components/reputation/reputation-badge.tsx` — renders
  the tier badge (colour per tier), `provisional ⇒ "New"`. **Never shows the
  numeric score.** Used by both profiles and marketplace.
- **`components/profile/profile-view.tsx`** — render `ReputationBadge` in the
  header next to the username.
- **Pages** `app/profile/page.tsx` & `app/profile/[username]/page.tsx` — fetch
  `getReputation` and pass `tier`/`provisional` into `ProfileView`.

## 8. Marketplace components changed

- **`packages/core/src/marketplace/query.ts` + `types.ts`** — add `creatorTier`
  / `creatorProvisional` to `MarketplaceListItem` via a LEFT JOIN to
  `user_reputation` on `bets.creator_user_id`.
- **`packages/core/src/marketplace/detail.ts` + `types.ts`** — add the same to
  `MarketplaceBetDetail`.
- **Bet list card component + `components/marketplace/bet-detail-view.tsx`** —
  render `ReputationBadge` for the creator. Tier badge only; no score.
- LEFT JOIN ⇒ creators without a snapshot show "New" (provisional default).

---

## 9. Test plan

**Core — pure scoring (`score.test.ts`)** — the fraud-resistance proof:
- each sub-score curve (exp/comp/vol/age/win) and weight contribution;
- integrity gate: frivolous & adverse rates reduce score multiplicatively;
- status modifier: suspended ≤ 30, banned = 0;
- provisional thresholds → tier `new` regardless of raw number;
- tier band mapping at each cutoff (19/20, 39/40, 59/60, 79/80);
- win-rate ≤5% influence; `winRateAnomaly` set at ≥20 samples & ≥0.95/≤0.05 with
  **no** score change;
- **adversarial**: wash loop (100 completed bets, 1 counterparty) scores far
  below an honest user (20 distinct counterparties), proving the anti-sybil design.

**Core — signals (`signals.test.ts`)** over a seeded pglite DB:
- distinct counterparty counting (repeat trades with same alt → counted once);
- completed vs matched vs open/void exclusion;
- per-counterparty volume cap (>100 with one CP capped; spread across CPs not capped);
- dispute classification (frivolous=rejected-opened, adverse=upheld-against);
- ageDays from `created_at`.

**Core — recompute (`recompute.test.ts`)**:
- writes a snapshot row; idempotent (same inputs → same row);
- updates after a new settlement; respects status (ban → 0).

**Queue / worker (`queue.test.ts`)**:
- `enqueueReputationRefresh` upserts/dedupes (two enqueues → one pending row);
- `drainReputationQueue`/`runReputationWorker` recomputes queued users, dequeues
  them, and isolates per-user failures (one bad user doesn't block others);
- the queue survives a recompute error (row not deleted until success).

**Event hooks** (extend existing suites): `settle.test.ts`, dispute tests, and
moderation tests assert the affected users are **enqueued** (a queue row exists
after commit) — and that the money-path itself never calls recompute / never
depends on it.

**Cron (`reputation-cron` test)**: advisory lock prevents concurrent runs;
drain mode processes the queue; `full` mode recomputes the expected user set.

**Web**: `getReputation` provisional-default behaviour covered in core; marketplace
query test asserts `creatorTier` is populated/joined. (Component rendering tests
follow existing repo norm — minimal.)

Target: keep the suite green; net new tests ≈ 25–35.

---

## 10. Rollout plan

1. **Ship dark (no UI):** migration 0010 + core `reputation` module + worker/
   nightly cron + enqueue hooks. Hooks only enqueue inside the money-tx, so
   production settlement is unaffected even if reputation has a bug.
2. **Backfill:** run `runReputationCycle(full)` once; spot-check snapshots
   (admin/SQL) for sanity (e.g. known active users land in expected tiers).
3. **Enable nightly cron** in `vercel.json`; confirm steady-state recompute.
4. **Ship UI:** `ReputationBadge` in profiles + marketplace, behind an env flag
   (`NEXT_PUBLIC_REPUTATION_BADGES=on`) so badges appear only after backfill
   looks correct. Provisional users render "New".
5. **Monitor:** watch cron duration + error logs; tune `config.ts` constants
   (weights/targets) without schema changes if distributions look off.

**Rollback:** flip the env flag off (hide badges); the table + hooks are additive
and non-blocking, so no data migration is needed to disable.

---

## 11. Out of scope (this sprint)

Net on-chain deposits, leaderboards, decay/recency weighting, explicit ring
detection, device/IP/KYC signals. (Deposits reserved for future Trust & Safety.)
