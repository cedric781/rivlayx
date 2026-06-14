# Sprint 20 — Production Hardening (Design)

> **Design only. No code, no infra changes this sprint.** Defines how RivlayX
> reaches production-grade operability before public users. Grounded in the
> actual stack: Next.js 15 on Vercel, Supabase Postgres (`auth`/`app`/
> `financial` schemas), Drizzle, Solana mainnet + USDC escrow, Helius RPC +
> webhooks, and the existing cron/lock/freeze/reconciliation primitives.

## 0. Guiding principles

1. **On-chain is the source of truth for funds.** USDC escrow lives on Solana;
   the internal ledger is a *projection* that must always reconcile to chain.
   Hardening centers on detecting and recovering divergence, never trusting the
   DB over chain for money.
2. **Fail safe, not open.** The existing `financial.freeze_state` kill-switch is
   the first containment tool for any money-impacting incident.
3. **Defense in depth on invariants.** Double-entry ledger, `tx_signature`/
   `bet`/payout uniqueness guards, and the reconciliation cron are existing
   invariants; monitoring/alerting must watch them continuously.
4. **Everything privileged is audited.** Build on `admin_audit_log` /
   `bet_audit_log`; extend coverage, never weaken it.
5. **Safety brakes bound blast radius.** `MAX_BET_USDC` (25) and `MAX_TVL_USDC`
   (1000) cap worst-case exposure during Fase 1 — hardening preserves and
   monitors these.

## 1. Monitoring

Four layers, each with golden signals (latency, traffic, errors, saturation):
- **App (Vercel)** — request rate, p50/p95/p99 latency, error rate, function
  timeouts/cold starts; structured logs with a request/correlation id.
- **Database (Supabase)** — connections vs pool limit, slow queries, replication/
  storage, lock waits (advisory-lock contention on crons).
- **Crons** — per-cron last-success time, duration, batch size, lag for
  `settle` / `recon` / `auto-resolve` / `reputation` / `risk`. A cron that
  hasn't succeeded within its interval is a first-class signal.
- **Chain + financial invariants** — Helius webhook freshness/lag, RPC health,
  deposit detection latency, and the **reconciliation invariant**
  (internal ledger Σ == on-chain escrow; ledger debits == credits; TVL == Σ open
  escrow). `reconciliation_runs` results are a monitored output, not just a log.
- **Business KPIs** — deposits, matched bets, settlements, payouts, dispute rate
  (dashboards for ops, not alerts).

## 2. Alerting

Severity-tiered, routed to on-call, deduped, each linked to a runbook (§12):
- **SEV1 (page immediately):** reconciliation mismatch (ledger ≠ chain), payout
  signer failure, TVL exceeded/near cap, freeze unexpectedly active/inactive,
  deposit webhook pipeline stalled, money-path cron failing repeatedly.
- **SEV2:** elevated error rate, cron lag beyond threshold, DB saturation,
  Helius/RPC degraded, payout retries climbing.
- **SEV3:** non-money cron lag (reputation/risk backlog), latency regressions.
- **Never alert on advisory risk scores** (Sprint 17 is shadow signal, not an
  ops alert). Alert on *engine health* (queue backlog), not on individual
  scores.
Alert hygiene: thresholds tuned to avoid fatigue, auto-resolve when healthy,
maintenance windows suppress expected noise.

## 3. Incident response

- **Severity model**: SEV1 money-impacting/integrity → SEV4 cosmetic, with
  response-time expectations per level.
- **Roles**: Incident Commander, Comms, Ops/Eng; for money incidents the IC
  authorizes **freeze-first containment** (flip the relevant `freeze_state`
  component) before deep investigation.
- **Flow**: detect → declare + severity → contain (freeze if money) → diagnose →
  mitigate → recover → verify reconciliation → stand down → **blameless
  postmortem** with action items.
- **Comms**: internal channel + status updates; user comms only when warranted
  and reviewed.
- Postmortems feed back into runbooks, alerts and SLOs.

## 4. Backups

- **Supabase automated backups + PITR** (point-in-time recovery); document the
  retention window and the **RPO** (max acceptable data loss).
- **Scope**: full Postgres (`auth`/`app`/`financial`). Secrets are NOT in the DB
  (they live in the secret store, §6).
- **Restore drills**: periodically restore to a scratch environment and verify
  integrity + that reconciliation passes — an untested backup is not a backup.
- **Chain as backstop**: because escrow is on-chain and deposits carry
  `tx_signature`, the financial ledger is *reconstructable* from chain + a
  backup even in a worst case.

## 5. Disaster recovery

- **Targets**: explicit **RTO** (time to restore service) and **RPO** per
  scenario.
- **Scenarios + procedures**: DB loss/corruption (restore PITR → reconcile vs
  chain), Supabase region outage, Helius outage (webhook backfill / RPC
  failover), Vercel outage, and **key compromise** (rotate + freeze).
- **Ledger rebuild**: the canonical recovery is rebuilding/verifying the internal
  ledger against on-chain escrow and deposit signatures; reconciliation is the
  acceptance test for "recovered".
- **DR drills**: scheduled game-days exercising restore + reconcile end to end.

## 6. Secrets management

- **Inventory**: `CRON_SECRET`, Supabase service/anon keys, Helius API key +
  **webhook signing secret**, Privy keys, Solana RPC keys, and — highest
  sensitivity — the **payout signer key**.
- **Storage**: Vercel encrypted env / a dedicated secret manager; **never in the
  repo** (the existing `gitleaks` + `.gitleaks.toml` guard stays in CI).
- **Rotation**: documented rotation cadence + emergency rotation runbook; rotate
  on any suspected compromise.
- **Least privilege + separation**: distinct prod/staging credentials; payout
  signer isolated and, as a future step, moved to a KMS/HSM-backed signer.
- **Verification**: Helius webhook signatures are verified (existing
  `packages/helius` verify) — a hardening item is ensuring every external
  callback path enforces it.

## 7. Audit logging

- Build on `admin_audit_log` / `bet_audit_log`; ensure **every privileged
  action** is captured: freeze toggles, manual settlement/void, payout approvals,
  secret rotations, and (future) enforcement actions.
- **Append-only + tamper-evident**, shipped to durable storage with retention;
  records who/what/when/why + before/after where relevant.
- Audit trails are an incident-response and compliance asset and must survive a
  DB restore (exported/replicated).

## 8. SLO / SLA

- **Internal SLOs** (Fase 1 is pre-public, so SLOs not external SLAs):
  - API availability + p95 latency.
  - **Deposit-credit time** (webhook → balance credited).
  - **Settlement time** (resolution → settled).
  - **Payout time** (settlement → on-chain payout).
  - **Reconciliation freshness** (max age of a clean recon run).
  - Cron freshness per job.
- **Error budgets** govern release pace; budget burn is itself alertable.
- A user-facing SLA is deferred until after public launch.

## 9. Load testing

- **Model peak**: bet create/accept, deposit-webhook bursts, settlement-cron
  throughput, marketplace reads, leaderboard/feed reads (future).
- **Stress the real limits**: Supabase connection pool, cron batch sizes,
  advisory-lock contention, Helius/RPC rate limits.
- **Bounded by safety brakes**: `MAX_TVL_USDC` caps total exposure, so load tests
  validate behaviour up to and at the cap (graceful rejection past it).
- Run against staging with synthetic data; capture latency/error curves and
  saturation points; set capacity headroom targets.

## 10. Chaos testing

Game-day fault injection to prove resilience of existing invariants:
- **DB**: latency spikes, brief unavailability, connection exhaustion.
- **Helius webhooks**: dropped / duplicated / **replayed** deposit events →
  verify `tx_signature` uniqueness dedup and no double-credit.
- **RPC**: failures/timeouts during payout → verify retry + no double-pay
  (payout double-queue guard).
- **Crons**: forced double-fire → verify advisory locks prevent double-run;
  mid-batch crash → verify idempotent resume.
- **Deploy/region failure** mid-operation.
Acceptance: invariants hold (no double-credit/pay, ledger reconciles, freeze
works); divergence is detected by recon and alerted.

## 11. Deployment safety

- **Preview deploys** (Vercel) per PR; CI gates (typecheck/lint/test) already
  enforced via husky pre-commit — extend to CI on the PR.
- **Migrations: expand/contract, forward-only, backward-compatible** — the
  additive pattern already used (0010–0012). Migrations run as a gated step
  *separate* from the app deploy; never a destructive migration coupled to a
  release.
- **Rollback plan** per release; app rollback is instant on Vercel, DB changes
  are forward-compatible so old + new code both work during rollout.
- **Kill-switches / freeze before risky changes**; **post-deploy smoke tests**
  (health + a reconcile check).
- No-downtime expectation; risky money-path changes deploy behind a freeze + a
  staged enablement.

## 12. Operational runbooks

Concrete, step-by-step runbooks (symptoms → diagnosis → action → escalation →
verification), at minimum:
- **Reconciliation mismatch** (ledger ≠ chain) — contain (freeze), investigate,
  reconcile, root-cause.
- **Stuck deposit** / orphan deposit resolution.
- **Failed/stuck payout** — diagnose signer/RPC, safe retry without double-pay.
- **Freeze / unfreeze** procedure (per component).
- **Secret rotation** (routine + emergency, esp. payout signer).
- **Cron stuck / lagging** — lock inspection, safe manual run.
- **Helius webhook re-sync / backfill** after an outage.
- **DB restore from PITR** + post-restore reconciliation.
- **Key compromise** response.
Every SEV1/SEV2 alert links to its runbook (§2).

## 13. Cost & capacity management

Goal: **detect cost problems early** — before they become a budget incident or a
capacity wall. All read-only observability + process; no infra change here.

- **RPC budget monitoring** — track Helius/RPC call volume and cost against a
  monthly budget; alert on burn-rate anomalies (e.g. a retry storm or a chatty
  deploy). Tie spikes back to the chaos/load findings (§9/§10).
- **Database growth forecasting** — trend row counts + storage per schema
  (`app`/`financial` grow fastest: bets, ledger_entries, settlements, plus the
  new risk_* / social_* tables); project months-to-limit and alert before the
  Supabase tier ceiling.
- **Log retention policy** — define retention per log class (app logs shorter;
  **audit logs long + durable**, §7); cap volume to control cost without losing
  the compliance/incident trail.
- **Object storage retention** — evidence uploads (Supabase Storage) retention +
  lifecycle (archive/expire stale, non-disputed evidence per policy); monitor
  bucket size and growth.
- **Cron cost monitoring** — track per-cron invocation count + compute time
  (settle/recon/auto-resolve/reputation/risk; the risk full-sweep is the
  heaviest); flag a cron whose cost grows super-linearly with data.
- **Alert volume monitoring** — watch alert/notification volume itself (paging
  fatigue + per-event cost); a noisy alert is both an ops and a cost problem.
- **Monthly infrastructure reporting** — a recurring cost report broken down by
  component (Vercel, Supabase compute/storage, RPC, Helius, storage), with
  month-over-month deltas and per-unit-of-activity cost (e.g. cost per settled
  bet) to catch efficiency regressions.
- **Capacity planning** — map projected growth (users/bets/TVL within the
  `MAX_TVL_USDC` cap) to resource headroom (DB connections, storage, RPC quota,
  cron windows); define when to scale tier or optimize before saturation.
- **Storage growth projections** — explicit projections for the largest tables
  and buckets (ledger, settlements, risk_edges, evidence) with retention applied,
  so growth is bounded and predictable.
- **Kill-switches for runaway jobs** — bound every batch/cron with hard limits
  (max batch size, max runtime, max RPC calls per run) and a switch to disable a
  job that is looping or burning budget — analogous to the `freeze_state`
  pattern, but for *compute/cost* runaways, never coupled to money components.
  The risk engine's `runRiskCycle`/worker limits are an existing example to
  generalise.

## 14. Out of scope (this sprint)

- All implementation, infra/config changes, and code.
- Any change to money-path behaviour, safety brakes, or schemas.
- External (customer-facing) SLA commitments (deferred to post-launch).
