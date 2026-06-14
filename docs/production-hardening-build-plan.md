# Sprint 20 — Production Hardening (Build Plan)

> **Design artifact only — no code, no infra changes this sprint.** Sequences
> the operability work implied by `docs/production-hardening-design.md`. Most of
> it is configuration, observability and process — not application logic — and
> must not alter money-path behaviour, safety brakes or schemas.

## 1. Workstreams (proposed)

| # | Workstream | Nature | Touches money path? |
| --- | --- | --- | --- |
| W1 | Monitoring + dashboards | observability config | no (read-only) |
| W2 | Alerting + on-call routing | config | no |
| W3 | Incident response process | process/docs | no |
| W4 | Backups + restore drills | infra/process | no (read-only) |
| W5 | Disaster recovery + drills | infra/process | recovery only |
| W6 | Secrets management + rotation | infra/security | no (handles creds) |
| W7 | Audit logging coverage | minor code (logging only) | no |
| W8 | SLO definition + error budgets | config/process | no |
| W9 | Load testing harness | staging tooling | staging only |
| W10 | Chaos testing / game-days | staging tooling | staging only |
| W11 | Deployment safety (CI/CD, migrations) | pipeline config | gating only |
| W12 | Operational runbooks | docs | no |
| W13 | Cost & capacity management | observability/process + job limits | no (read-only + caps) |

Guard: any work that would change money-path code, safety brakes
(`MAX_BET_USDC`/`MAX_TVL_USDC`) or schemas is **out of scope** and must be a
separate, reviewed change.

## 2. Instrumentation points (proposed, read-only)

- **Reconciliation as a health source**: surface `reconciliation_runs` status +
  age as a monitored metric and SEV1 alert on mismatch.
- **Cron health**: emit per-cron last-success/duration/lag (settle, recon,
  auto-resolve, reputation, risk) → dashboards + lag alerts.
- **Deposit pipeline**: Helius webhook receipt → credit latency; webhook
  signature-verification failures.
- **Financial invariants**: periodic check that ledger debits == credits and TVL
  == Σ open escrow (read-only query; alert on drift).
- **App/DB golden signals** via the platform (Vercel/Supabase) metrics.
Audit-logging coverage (W7) is the only code change: add structured privileged-
action logging where gaps exist — purely additive, no behavioural change.

## 3. Backup / DR plan (proposed)

- Confirm Supabase PITR enabled; document retention, RPO, RTO.
- Quarterly **restore drill** to scratch env + run reconciliation as the
  acceptance test.
- DR scenario runbooks (DB loss, region/Helius/Vercel outage, key compromise);
  ledger-rebuild-from-chain procedure documented and rehearsed.

## 4. Secrets plan (proposed)

- Inventory + classify all secrets (design §6); payout signer = highest tier.
- Move/confirm storage in Vercel encrypted env / secret manager; keep `gitleaks`
  in CI; add rotation cadence + emergency-rotation runbook; plan KMS/HSM for the
  payout signer.

## 5. SLO plan (proposed)

- Define SLO targets + error budgets for availability, deposit-credit, settlement,
  payout, reconciliation freshness, cron freshness.
- Wire budget burn into alerting; review cadence.

## 6. Load + chaos plan (proposed, staging only)

- Load harness modelling peak flows, bounded by `MAX_TVL_USDC`; record saturation
  points and headroom.
- Chaos/game-day catalog: webhook drop/dup/replay, RPC failure during payout,
  cron double-fire, DB latency/outage. **Acceptance = invariants hold**
  (no double-credit/pay, ledger reconciles, freeze works) and divergence is
  detected + alerted. Never run against production money.

## 7. Deployment-safety plan (proposed)

- CI pipeline runs typecheck/lint/test on PRs (extend the existing husky
  pre-commit gates to CI).
- Migration policy doc: expand/contract, forward-only, backward-compatible; run
  migrations as a gated step decoupled from app deploy; rollback playbook.
- Post-deploy smoke test (health + reconcile check); freeze-before-risky-deploy
  convention.

## 8. Test / validation plan

- **Restore drill** passes reconciliation.
- **Chaos acceptance** checks (idempotency/dedup invariants) pass on staging.
- **Alert tests**: synthetic faults fire the right severity + link a runbook.
- **Load targets** met with headroom at the TVL cap.
- No regression to the existing 494-test suite (W7 logging additions covered by
  tests).

## 9. Rollout (proposed order)

1. W1/W2 monitoring + alerting (visibility first).
2. W7 audit coverage + W12 runbooks (respond to what you can see).
3. W4/W5 backups + DR drills, W6 secrets.
4. W8 SLOs + error budgets.
5. W11 deployment safety / CI.
6. W9/W10 load + chaos, iterated as game-days.
7. W13 cost & capacity reporting + runaway-job kill-switches (continuous).

## 10. Out of scope (this sprint)

- All implementation, infra/config changes and code.
- Any change to money-path behaviour, safety brakes or schemas.
- External SLA commitments.
