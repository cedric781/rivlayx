# Sprint 24 — Operations Hardening (Design)

> **Design only. No code, no infra changes this sprint.** Closes the five gaps
> surfaced by the Sprint 23 Operations Review against the now-merged ops layer
> (`packages/core/src/ops/*`, `app.cron_runs` / `app.ops_alerts`, the
> `/api/health` + `/api/ops/health` endpoints, the `/api/cron/ops` cycle, and the
> admin dashboard panel). Sprint 23 made the system **observable**; Sprint 24
> makes that observability **operationally usable and self-sustaining** — without
> touching money-path behaviour, safety brakes (`MAX_BET_USDC` / `MAX_TVL_USDC`)
> or schemas beyond purely additive ops tables/columns.

## 0. Guiding principles

1. **Advisory, never enforcing.** Everything here stays read-only against money
   state. The ops layer pages and visualises; the money-path freeze/recon logic
   remains the only enforcement.
2. **No vendor lock-in.** Keep the generic-webhook model from Sprint 23
   (`notifier.ts`). External monitoring integrates by configuration, not by an
   SDK dependency in the codebase.
3. **Self-sustaining.** A monitoring system that grows unboundedly or that can't
   detect its own failure is a liability. Retention and self-monitoring are
   first-class, not afterthoughts.
4. **Fail safe on instrumentation.** As in Sprint 23 (`safeInsert` swallows
   recording errors), no hardening step may ever break a cron or a request path.
5. **Tested to the same bar.** Every change lands with unit + PGlite db-tests and
   keeps the suite green; the money-path isolation test stays as a guardrail.

## 1. Gap 1 — `cron_runs` retention / pruning

**Problem.** `app.cron_runs` gets one row per cron invocation (~5 jobs every
5–15 min ≈ 1k+ rows/day, ~400k/year), with no TTL. The `(job, finished_at)`
index keeps the `DISTINCT ON (job)` freshness read fast, but the table grows
forever — storage cost and slowly degrading scans.

**Architecture.**
- A **retention window** added to `OpsConfig` (`cronRuns.retentionDays`, default
  **30**). Long enough for trend/debug, short enough to bound growth.
- A **prune step** folded into the existing `runOpsCycle` (the `/api/cron/ops`
  job, already every 15 min, already advisory-locked): delete `cron_runs` where
  `finished_at < now() - retentionDays`. Reuses the lock + schedule — **no new
  cron**.
- **Safety**: never prune the latest row per job (freshness source of truth), so
  a job that runs less often than the window still has its last run. Deletion is
  bounded (`LIMIT` batch) so a backlog can't produce a single huge statement.
- The prune count is returned in `OpsCycleResult` (`pruned`) and surfaced in the
  cycle's JSON response for visibility.

**Alternatives considered.** A DB-level `pg_cron`/partitioning approach is more
"correct" at scale but adds infra and a Supabase dependency; at Fase-1 volumes a
config-driven delete in the existing cycle is simpler and vendor-neutral.
Partitioning is noted as a **post-launch** option if volume outgrows the delete.

## 2. Gap 2 — Runbook documentation

**Problem.** `OPS_DEFAULTS.runbooks` deep-links every alert type to
`/docs/runbooks#<anchor>` (`#cron-stuck`, `#reconciliation-mismatch`,
`#tvl-breach`, `#freeze-unfreeze`, `#incident-response`). The dashboard and (after
Gap 5) the webhook link these — but **`docs/runbooks.md` does not exist**, so
every link is dangling.

**Architecture.**
- Author **`docs/runbooks.md`** with one anchored section per alert type, each
  following the established pattern from `production-hardening-design.md §12`:
  **symptoms → diagnosis → action → escalation → verification**.
- Anchors must match the config exactly:
  `#cron-stuck`, `#reconciliation-mismatch`, `#tvl-breach`, `#freeze-unfreeze`,
  `#incident-response`. A tiny **link-integrity test** (parse `OPS_DEFAULTS.runbooks`,
  assert each anchor exists in `docs/runbooks.md`) prevents future drift — this is
  the one piece of "code" in an otherwise docs gap, and it's test-only.
- Content is grounded in **real primitives**: freeze via `financial.freeze_state`
  components, advisory-lock inspection for stuck crons, the recon cron's
  auto-freeze behaviour, and the safe manual-run path. No new procedures invented
  beyond what the system already supports.
- Decide the **serving host** for the relative `/docs/...` path (admin app static
  route vs. repo-rendered). Default: serve from the admin app so authed on-call
  staff reach it from the dashboard link.

## 3. Gap 3 — `health_degraded` alert wiring

**Problem.** `health_degraded` is fully configured (type enum, default severity
`warning`, runbook `#incident-response`) but **`evaluateOps` never emits it** —
dead config. Meanwhile `getHealthSnapshot` already computes a roll-up
`degraded`/`down` status that nothing converts into a pageable alert.

**Decision (locked):** **keep `health_degraded` and wire it as a catch-all.**
Emit it in `evaluateOps` via a terminal rule: when the snapshot reflects an
aggregate-degraded condition **not already covered by any of the six specific
alerts** (`cron_failed`, `cron_stale`, `reconciliation_stale`,
`reconciliation_drift`, `tvl_near_cap`, `freeze_active`) — i.e. the would-be
specs list is empty but the `getHealthSnapshot` roll-up is non-`ok` — emit a
single `health_degraded` (dedupKey `health`). This keeps the pure evaluator the
single source of alerts and provides the "something is wrong we didn't name" net.
Severity escalates to `critical` when the health roll-up is `down`, else
`warning`.

**Decision criterion (satisfied):** it fires **only** when no specific alert
does, so it never double-pages an already-named condition.

**Risk control.** Whichever path, `evaluateOps` stays pure and unit-tested, and
the catch-all must be guarded against double-paging (dedup with the specific
alerts via the `health` key + the "specs empty" precondition).

## 4. Gap 4 — External monitoring strategy

**Problem.** The ops cron monitors all crons **including itself**; if the ops
cron dies, nothing internal pages ("who watches the watcher"). The intended
mitigation — an external uptime monitor hitting `/api/ops/health` (which already
returns 200/503) — is **not wired or documented**, and that endpoint currently
shares `CRON_SECRET` with whatever vendor would poll it.

**Architecture.**
- **External probe** (UptimeRobot / Better Stack / Pingdom / equivalent) polls
  `/api/ops/health` on a fixed interval (≈1–2 min) and pages on a non-200. This
  is the **independent** liveness signal that survives an ops-cron outage,
  Vercel function failure, or DB-down.
- **Auth model (security, locked):** introduce a **dedicated read-only health
  token** (`OPS_HEALTH_TOKEN`) separate from `CRON_SECRET`. **`CRON_SECRET` is
  never shared with monitoring vendors.** `/api/ops/health` accepts either the
  health token **or** the cron secret (the latter for internal use); `/api/cron/*`
  keep requiring the cron secret only. `/api/health` (liveness) stays public.
- **Layered probes:** `/api/health` (public liveness, "process up") for cheap
  high-frequency checks; `/api/ops/health` (token-gated readiness, dependency
  roll-up) for the paging probe. Document which probe pages whom.
- **Self-watch alert:** because the external monitor is the backstop, document it
  as a **launch prerequisite** and add it to the deploy checklist — the system
  cannot self-detect its own total outage.
- **Skipped-vs-stuck note:** document that a permanently lock-held cron records
  `skipped` and looks fresh; the external `/api/ops/health` + manual lock
  inspection (runbook `#cron-stuck`) is the catch for a genuinely stuck holder.

## 5. Gap 5 — Webhook payload enrichment

**Problem.** The dispatched envelope
(`{ source, type, severity, title, dedupKey, evidence }`) omits **`runbookUrl`,
`timestamp`, and the alert `id`** — so an on-call paged at 03:00 gets no runbook
link, no time context, and no handle back to the dashboard row.

**Architecture.**
- Enrich the envelope (additive, backward-compatible) to:
  ```jsonc
  {
    "source": "rivlayx-ops",
    "id": "<ops_alerts.id uuid>",
    "type": "reconciliation_drift",
    "severity": "critical",
    "title": "Reconciliation drift (drift 12.500000 USDC)",
    "dedupKey": "recon",
    "runbookUrl": "https://<host>/docs/runbooks#reconciliation-mismatch",
    "timestamp": "2026-06-14T22:30:00.000Z",
    "evidence": { "status": "drift", "driftUsdc": "12.500000", "ageMinutes": 4 }
  }
  ```
- **Plumbing change:** today `dispatchOpsAlerts` receives `OpsAlertSpec[]`
  (no id/runbook yet — those are set at insert in `upsertOpsAlert`). The cycle
  must dispatch **after** insert and pass the persisted row's `id` + resolved
  `runbookUrl`. Cleanest shape: `upsertOpsAlert` returns the created row (id +
  runbookUrl) instead of a bare boolean, and `runOpsCycle` dispatches those.
- **Absolute runbook URL:** the webhook is consumed off-platform, so the runbook
  link must be absolute. Add `OPS_PUBLIC_BASE_URL` (or derive from an existing
  env) to turn the relative `/docs/runbooks#...` into a clickable absolute URL;
  keep the relative form for the in-app dashboard.
- **Timestamp:** stamp at dispatch from the persisted `created_at` (not
  `Date.now()` inline, to stay test-deterministic — pass the row through).
- **Stays vendor-neutral:** still a generic JSON POST; provider-specific shaping
  remains a relay/config concern, not a code dependency.

## 6. Risks

| # | Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| R1 | Prune deletes the only/last run of a rarely-run job → false `never`/stale | low | medium | Never prune the latest row per `job`; retention ≫ slowest interval; db-test asserts last row survives |
| R2 | Prune batch locks/bloats on first run against an existing backlog | low | low | Bounded `LIMIT` batch per cycle; runs under the existing ops advisory lock |
| R3 | `health_degraded` double-pages alongside specific alerts | medium | low | Emit only when no specific spec fired + dedupKey `health`; unit-tested |
| R4 | New `OPS_HEALTH_TOKEN` misconfigured → health probe 401, false page or silent gap | medium | medium | Accept cron-secret as fallback; document in env + deploy checklist; smoke-test the probe post-deploy |
| R5 | Enriched webhook leaks more internal financial detail off-platform | low | medium | Payload unchanged in *content classes* (already had evidence); send only to a trusted destination; documented in security note |
| R6 | Absolute runbook URL misconfigured → dead link in page | low | low | Fallback to relative; link-integrity test covers anchors, not host |
| R7 | Dispatch-after-insert reordering changes paging timing/dedup | low | medium | Covered by the existing PGlite cycle test (create→dedup→resolve) extended for dispatch payload |
| R8 | Runbook content drifts from real procedures | medium | medium | Ground every step in existing primitives; link-integrity test; review gate |

## 7. Rollout plan

1. **Land behind no behaviour change.** All five items are additive
   (config field, docs, additive alert rule, new optional env, richer payload).
   Nothing gates money; nothing changes existing alert semantics except the new
   `health_degraded` rule.
2. **Migrations (if any) are additive only.** Gaps 1/3/5 need no schema change
   (retention is a delete; enrichment reads existing columns). If `health_degraded`
   needs nothing new, **zero migrations** — confirm during build.
3. **Config defaults are safe-on:** `retentionDays: 30` and the new alert rule
   ship enabled; `OPS_HEALTH_TOKEN` / `OPS_PUBLIC_BASE_URL` are optional —
   absent ⇒ graceful fallback (no-op / relative URL), so deploy never breaks.
4. **External monitor is a deploy step, not code:** wire the uptime probe to
   `/api/ops/health` with the health token as part of the launch checklist.
5. **Post-deploy smoke test:** hit `/api/health` (200), `/api/ops/health`
   (200/503 + correct shape), trigger a synthetic alert and confirm the enriched
   webhook fires with a working absolute runbook link.
6. **Rollback:** every item is independently revertable; instant Vercel app
   rollback, and retention/alert-rule are config-flippable.

## 8. Implementation order (for the build plan)

Ordered by **value-per-risk** and dependency:

1. **Gap 2 — runbooks** (docs + link-integrity test). Pure docs, unblocks the
   value of every alert link; lowest risk, prerequisite for Gap 5's URL.
2. **Gap 4 — external monitoring** (`OPS_HEALTH_TOKEN` + endpoint auth +
   checklist). Closes the highest-severity blind spot (watcher self-failure).
3. **Gap 1 — `cron_runs` retention** (config + prune in `runOpsCycle`). Bounds
   growth; independent of the others.
4. **Gap 5 — webhook enrichment** (return row from `upsertOpsAlert`, dispatch
   after insert, absolute URL). Depends on Gap 2 (runbook anchors) for the link.
5. **Gap 3 — `health_degraded` wiring** (catch-all, decision locked in §3). Last,
   because it benefits from the other signals being settled first.

## 9. Out of scope (this sprint)

- All implementation and code (this sprint is design + build plan only).
- Any change to money-path behaviour, safety brakes, or schemas beyond purely
  additive, reviewed ops fields.
- Choosing/contracting a specific external monitoring vendor (strategy only).
- The broader Sprint 20 hardening backlog (backups/DR/SLO/load/chaos/secrets
  rotation) — this sprint is scoped strictly to the five Operations Review gaps.
