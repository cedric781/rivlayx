# Sprint 24 — Operations Hardening (Build Plan)

> **Design artifact only — no code this sprint.** Sequences the implementation of
> the five Operations Review gaps defined in
> `docs/operations-hardening-design.md`. All work is additive and advisory;
> **no money-path behaviour, safety brakes or non-additive schema changes**. The
> existing 508-test suite must stay green and the money-path isolation test
> (`ops.db.test.ts` — "a full ops cycle mutates no money tables") remains a
> guardrail throughout.

## 1. Workstreams

| # | Gap | Nature | Touches money path? | New schema? |
| --- | --- | --- | --- | --- |
| G1 | `cron_runs` retention/pruning | config + prune in existing cycle | no | no |
| G2 | Runbook documentation | docs + link-integrity test | no | no |
| G3 | `health_degraded` alert wiring | additive evaluator rule (or removal) | no | no |
| G4 | External monitoring strategy | endpoint auth + env + checklist | no (read-only) | no |
| G5 | Webhook payload enrichment | notifier/cycle plumbing | no | no |

Guard: any change that would alter money-path code, freeze/recon enforcement,
`MAX_BET_USDC` / `MAX_TVL_USDC`, or require a non-additive migration is **out of
scope** and must be a separate, reviewed change.

## 2. Build order

Per design §8 + the review's revision (G5 last — largest regression surface):
**G2 → G4 → G1 → G3 → G5.**

### Step 1 — G2: Runbooks
- Create `docs/runbooks.md` with anchored sections matching `OPS_DEFAULTS.runbooks`
  exactly: `#cron-stuck`, `#reconciliation-mismatch`, `#tvl-breach`,
  `#freeze-unfreeze`, `#incident-response`.
- Each section: **symptoms → diagnosis → action → escalation → verification**,
  grounded in real primitives (`freeze_state` components, advisory-lock
  inspection, recon auto-freeze, safe manual run).
- Add a **link-integrity test**: read `OPS_DEFAULTS.runbooks`, assert every anchor
  resolves to a heading in `docs/runbooks.md`.
- Decide + document the serving host for the relative `/docs/...` path.
- **Acceptance:** every alert type's runbook anchor resolves; test fails if an
  anchor is added without a section.

### Step 2 — G4: External monitoring
- Add optional `OPS_HEALTH_TOKEN` to env schema (both apps as needed).
- Update `/api/ops/health` auth to accept the health token **or** `CRON_SECRET`;
  leave `/api/cron/*` on cron-secret only; `/api/health` stays public.
- Document the uptime-probe wiring (interval, expected 200/503, which probe pages
  whom) and add it to the **deploy/launch checklist**.
- Document the skipped-vs-stuck nuance and its catch (`#cron-stuck`).
- **Acceptance:** `/api/ops/health` returns 200/503 with the health token; 401
  without either secret in prod; cron-secret fallback works; checklist updated.

### Step 3 — G1: `cron_runs` retention
- Add `cronRuns.retentionDays` (default 30) to `OpsConfig` / `OPS_DEFAULTS`.
- Add a bounded prune (delete `finished_at < now() - retentionDays`, `LIMIT`
  batch, **never the latest row per job**) and call it inside `runOpsCycle`.
- Return `pruned` in `OpsCycleResult` + the `/api/cron/ops` response.
- **Acceptance:** db-test — old rows pruned, the latest row per job always
  survives (rarely-run job not falsely marked `never`), batch bounded.

### Step 4 — G3: `health_degraded` wiring (catch-all — decision locked)
- **Decision:** keep `health_degraded` and wire it as a catch-all.
- Add a terminal rule in `evaluateOps` — emit `health_degraded` (dedupKey
  `health`) only when **no specific spec fired** (none of `cron_failed`,
  `cron_stale`, `reconciliation_stale`, `reconciliation_drift`, `tvl_near_cap`,
  `freeze_active`) but the `getHealthSnapshot` roll-up is non-`ok`; escalate to
  `critical` when the roll-up is `down`, else `warning`.
- **Acceptance:** unit-test proves it fires only when no specific alert does and
  never double-pages a named condition; `evaluateOps` stays pure.

### Step 5 — G5: Webhook enrichment (last — largest regression surface)
- Change `upsertOpsAlert` to return the persisted row (`id`, `runbookUrl`,
  `createdAt`) instead of a bare boolean; update `runOpsCycle` to dispatch
  **after** insert using those values.
- Add `OPS_PUBLIC_BASE_URL` (optional) to build an absolute runbook URL; relative
  fallback when absent.
- Enrich the envelope with `id`, `runbookUrl` (absolute), `timestamp` (from
  persisted `created_at`).
- **Acceptance:** unit/db-test — dispatched payload contains id + absolute
  runbook + timestamp; no double-dispatch; dedup/auto-resolve unchanged.

## 3. Test / validation plan

- **Per-step acceptance** above, each with unit + PGlite db-tests.
- **Regression:** full suite green (508 → 508 + new tests); no flakiness.
- **Real-PG16 check:** if any additive migration appears (not expected), validate
  it via `db:migrate` against Docker `postgres:16-alpine` as in Sprint 23.
- **Isolation guardrail:** the "ops cycle mutates no money tables" test must still
  pass after the retention delete + dispatch reordering.
- **Smoke (post-deploy):** `/api/health` 200; `/api/ops/health` 200/503 + shape;
  synthetic alert → enriched webhook with working absolute runbook link.

## 4. Rollout

1. Land G2–G5 as additive, behaviour-preserving changes; G3 last (carries the
   open decision).
2. Defaults safe-on (`retentionDays: 30`, new alert rule); `OPS_HEALTH_TOKEN` /
   `OPS_PUBLIC_BASE_URL` optional with graceful fallback.
3. Wire the external uptime probe to `/api/ops/health` as a launch-checklist step
   (config/infra, not code).
4. Post-deploy smoke test; each item independently revertable (instant app
   rollback + config flips).

## 5. Decisions (locked) & remaining questions

**Locked (this review):**
- **G3:** keep `health_degraded`, wired as a catch-all that fires only when none
  of the six specific alerts fire (see design §3).
- **G4:** use a dedicated `OPS_HEALTH_TOKEN`; **`CRON_SECRET` is never shared with
  monitoring vendors** (cron secret remains accepted on `/api/ops/health` for
  internal use only).

**Remaining (confirm during build):**
1. **G2/G5:** serving host + `OPS_PUBLIC_BASE_URL` for absolute runbook links.
2. **G1:** 30-day retention default, and whether `pruned` should also be recorded
   (vs. only returned) for trendability.
3. **G4:** name a default uptime vendor (contracting stays out of scope).

## 6. Out of scope (this sprint)

- All implementation and code (design + build plan only).
- Any money-path, safety-brake, or non-additive schema change.
- Vendor selection/contracting for external monitoring.
- The wider Sprint 20 hardening backlog (backups/DR/SLO/load/chaos/secrets
  rotation) beyond the five Operations Review gaps.
