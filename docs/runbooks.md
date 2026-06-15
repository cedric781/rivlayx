# RivlayX Operational Runbooks

> On-call procedures for the ops alerts emitted by the Sprint 23 ops layer
> (`packages/core/src/ops`). Every alert type in `OPS_DEFAULTS.runbooks`
> deep-links to a section here. Each runbook follows:
> **symptoms → diagnosis → action → escalation → verification**. Procedures are
> grounded in the real primitives the system already exposes — the
> `financial.freeze_state` kill-switch, advisory locks on crons, the
> reconciliation cron's auto-freeze, and the read-only health endpoints. **No
> procedure here moves money or bypasses a safety brake.**

> **Containment first.** For any money-impacting or integrity incident, freezing
> the relevant `financial.freeze_state` component (see
> [Freeze unfreeze](#freeze-unfreeze)) is the first action — contain, then
> diagnose.

---

## Cron stuck

**Alert types:** `cron_stale`, `cron_failed`.

**Symptoms.**
- Dashboard "Cron health" badge shows a job `stale (Nm)`, `failing`, or
  `never run`.
- `cron_stale` (warning) or `cron_failed` (critical) alert open.
- Downstream effects: settlements/payout-enqueue lagging (settle), reconciliation
  not refreshing (recon), disputes not auto-resolving (auto-resolve).

**Diagnosis.**
1. Check the job's recent `app.cron_runs` rows: last `status`, `finished_at`,
   `duration_ms`, and `details` (the `failed` row carries the error message).
2. `failing` ⇒ the work threw — read `details.error`.
3. `stale`/`never` with no recent row ⇒ the cron isn't firing (Vercel Cron
   misconfig, deploy issue) **or** every run is `skipped` because the advisory
   lock is held — inspect Postgres advisory locks
   (`pg_locks` where `locktype = 'advisory'`) for a stuck holder (the
   `CRON_LOCK_KEYS` value, e.g. `920_001` settle).
4. Cross-check `/api/ops/health` (`crons` check) for the authoritative view.

**Action.**
1. If a lock is held by a dead/zombie session, the advisory lock auto-releases on
   connection close; if a session is genuinely stuck, terminate that backend
   (`pg_terminate_backend`) so the next scheduled run can acquire the lock. Never
   delete `cron_runs` rows to "fix" freshness.
2. If the cron isn't firing, verify the schedule in `vercel.json` and the cron
   deploy; trigger a manual run by calling the route with the cron bearer
   (`Authorization: Bearer $CRON_SECRET`). Manual runs are safe: every cron is
   idempotent and guarded by its advisory lock, so a manual run cannot
   double-process.
3. If the work is failing, fix the root cause (provider outage, bad data) before
   re-running.

**Escalation.** A failing **money-path** cron (settle) that cannot be recovered
quickly → escalate to on-call eng and consider freezing `settlements` until
resolved.

**Verification.** A fresh `ok` row in `app.cron_runs` for the job; the dashboard
badge returns to `ok (Nm)`; the alert auto-resolves on the next ops cycle.

---

## Reconciliation mismatch

**Alert types:** `reconciliation_drift`, `reconciliation_stale`.

**Symptoms.**
- `reconciliation_drift` (critical): the latest `financial.reconciliation_runs`
  status is `drift` or `halt` with a non-zero `drift_usdc` — the internal ledger
  disagrees with on-chain escrow.
- `reconciliation_stale` (warning): no recon run within
  `reconciliation.maxAgeMinutes` (default 180), or never run.

**Diagnosis.**
1. Read the latest `reconciliation_runs` row: `status`, `ledger_total_usdc`,
   `on_chain_total_usdc`, `drift_usdc`, `details`.
2. **On-chain is the source of truth for funds.** Treat any drift as the ledger
   being wrong about chain until proven otherwise.
3. For `stale`, this is a freshness problem — see [Cron stuck](#cron-stuck) for
   the `recon` job; drift is not (yet) indicated.

**Action.**
1. **Drift/halt → contain first:** freeze the affected money components
   (`withdrawals`, and `settlements`/`new_bets` if integrity is in question) via
   [Freeze unfreeze](#freeze-unfreeze). The recon cron may already auto-freeze;
   confirm.
2. Investigate the divergence (a missed deposit credit, a webhook replay, a
   payout discrepancy) using `ledger_entries` + on-chain `tx_signature` history.
   The ledger is reconstructable from chain + deposit signatures.
3. Do **not** hand-edit balances. Corrections go through the normal ledger
   primitives under eng supervision.

**Escalation.** Any confirmed money drift is a SEV1: page on-call eng + incident
commander immediately; keep the freeze until reconciliation is clean.

**Verification.** A new `reconciliation_runs` row with status `ok` and
`drift_usdc = 0`; alerts auto-resolve; unfreeze only after a clean recon.

---

## TVL breach

**Alert type:** `tvl_near_cap`.

**Symptoms.**
- `tvl_near_cap` (warning): current TVL ≥ `tvl.capUsdc × tvl.warnRatio`
  (default 90% of the `MAX_TVL_USDC` brake).

**Diagnosis.**
1. Confirm current TVL on the dashboard vs the `MAX_TVL_USDC` safety brake.
2. This is an **expected Fase-1 capacity signal**, not an integrity problem — the
   deposit path already rejects deposits that would exceed the cap.
3. Decide whether this is organic growth (good) or anomalous concentration.

**Action.**
1. No emergency action: the cap is a designed brake; new deposits past it are
   rejected gracefully by the deposit path (no code change here).
2. If sustained near the cap and growth is healthy, plan a reviewed,
   separate change to raise `MAX_TVL_USDC` (money-path change — out of ops scope).
3. If anomalous, investigate the depositing accounts.

**Escalation.** Sustained at-cap blocking legitimate users → product + eng to
schedule a brake review.

**Verification.** TVL falls back below the warn ratio (settlements/withdrawals)
or the cap is deliberately, reviewably raised; alert auto-resolves.

---

## Freeze unfreeze

**Alert type:** `freeze_active`. Also the primary **containment** procedure for
every other money/integrity incident.

**Symptoms.**
- `freeze_active` (warning): one or more `financial.freeze_state` components are
  `frozen = true`. This may be **expected** (you just froze for containment) or
  **unexpected** (investigate why).

**Diagnosis.**
1. Read `financial.freeze_state` for the frozen components
   (`new_bets`, `settlements`, `withdrawals`, `all`).
2. Correlate with any open incident — was this an intentional containment freeze?
3. If unexpected, treat as an incident: find who/what set it (audit log).

**Action — to freeze (contain):**
1. Set the relevant `freeze_state` component(s) to frozen. `all` is the broadest
   brake; prefer the narrowest component that contains the incident
   (e.g. `withdrawals` for a payout concern).
2. Freezing is the first move for any money-impacting incident; it stops new
   exposure without unwinding existing state.

**Action — to unfreeze (recover):**
1. Unfreeze **only** after the underlying condition is resolved and verified
   (for money incidents: a clean reconciliation — see
   [Reconciliation mismatch](#reconciliation-mismatch)).
2. Unfreeze the narrowest component first; observe before widening.

**Escalation.** An unexpected freeze with no known cause → SEV1; an inability to
unfreeze after resolution → eng.

**Verification.** `freeze_state` reflects the intended state; `/api/ops/health`
`freeze` check returns `ok` when nothing should be frozen; alert auto-resolves
once components are unfrozen.

---

## Incident response

**Alert type:** `health_degraded` (catch-all), plus the umbrella process for any
SEV1/SEV2.

**Symptoms.**
- `health_degraded`: the system health roll-up (`/api/ops/health`) is
  `degraded`/`down` for a reason **not** already covered by a specific alert
  (`cron_failed`, `cron_stale`, `reconciliation_stale`, `reconciliation_drift`,
  `tvl_near_cap`, `freeze_active`) — e.g. a database-reachability degradation.
- Or: an external uptime probe reports `/api/ops/health` non-200, or `/api/health`
  liveness failing.

**Diagnosis.**
1. Hit `/api/ops/health` (with `OPS_HEALTH_TOKEN` or the cron secret) and read the
   `checks[]` array — `database`, `crons`, `reconciliation`, `freeze` — to localise
   the degradation.
2. `database` down ⇒ DB/connectivity incident (the ops cycle itself can't record;
   rely on the external probe).
3. If a specific check is the cause, branch to its runbook above.

**Action.**
1. Declare an incident + severity. For money-impacting/integrity issues, **contain
   first** via [Freeze unfreeze](#freeze-unfreeze).
2. Assign Incident Commander; communicate on the incident channel.
3. Diagnose → mitigate → recover → **verify reconciliation** → stand down.

**Escalation.** SEV1 (money/integrity) pages on-call eng + IC immediately; SEV2
within the on-call SLA.

**Verification.** `/api/ops/health` returns `ok`; the originating alert
auto-resolves; a blameless postmortem captures action items that feed back into
these runbooks and the alert thresholds.

---

## Appendix — External monitoring (wiring)

The ops cron monitors all crons **including itself**, so it cannot detect its own
total outage. The backstop is an **external uptime monitor** — this is a
deploy/launch prerequisite, not application code.

- **Probe:** an external uptime service (e.g. Better Stack / UptimeRobot /
  Pingdom) polls `GET /api/ops/health` every 1–2 minutes and pages on any
  non-200. It returns **200** when healthy and **503** when `degraded`/`down`.
- **Auth:** send `Authorization: Bearer <OPS_HEALTH_TOKEN>` — a dedicated
  read-only token. **Never share `CRON_SECRET` with a monitoring vendor.** The
  endpoint also accepts the cron secret for internal callers.
- **Liveness vs readiness:** `GET /api/health` is public and cheap ("process
  up"); use it for high-frequency liveness. `GET /api/ops/health` is the
  dependency-roll-up readiness probe that should page on-call.
- **Skipped-vs-stuck:** a perpetually lock-held cron records `skipped` and looks
  fresh; the external readiness probe plus [Cron stuck](#cron-stuck) lock
  inspection is the catch for a genuinely stuck lock holder.

**Launch checklist:** the external probe must be configured against
`/api/ops/health` with `OPS_HEALTH_TOKEN`, verified to page on an induced 503,
before relying on the ops layer in production.
