# RivlayX — Gap Analysis (Sprint 22)

> **Design/assessment only. No code, no implementation.** A full,
> evidence-based readiness assessment across all domains, grounded in what is
> actually committed to `main` (implemented + tested) versus what exists only as
> a design document. Goal: a clear, honest picture of what is launch-blocking.

## Method

- **Implemented** = code on `main` with passing tests (current suite: **494
  tests, 66 files**).
- **Designed** = a `docs/*` design exists; **no code**.
- Readiness is scored for a **public mainnet money launch** (the bar is high
  because real USDC is at stake), not for a demo. Rubric:
  - 90–100 launch-ready · 70–89 mostly ready, gaps to close · 50–69 partial ·
    30–49 early · 0–29 design-only/absent.

Evidence of implementation (test coverage by domain): bets 17, ledger 8,
deposits 5, payouts 5, marketplace 5, reputation 3, risk 2, cron 2, admin 1,
profiles 1. No monitoring/alerting/observability third-party integration exists
yet.

---

## 1. Product (core wagering)
**Done:** bet lifecycle (create/accept/settle/cancel/expire), templates, open
objective + sports, evidence + arbiter + auto resolve (API-Football/CoinGecko),
disputes, marketplace (browse/filter/detail/share), profiles + bet history.
Broadly tested.
**Partial:** UX polish; social surfaces (designed only).
**Missing:** social/growth features (Sprint 19 design only).
**Before launch:** core paths verified on mainnet at low caps (Sprint 21 L1).
**Can wait:** social/growth, advanced bet types.
**Readiness: 80.**

## 2. Money flow
**Done:** double-entry ledger, escrow, deposits via Helius webhooks with
`tx_signature` dedup, reconciliation cron + `reconciliation_runs`, settlement,
payouts (with double-pay guard), draw refunds, safety brakes (`MAX_BET_USDC` 25,
`MAX_TVL_USDC` 1000), `freeze_state` kill-switch. Heavily tested (ledger/
deposits/settle/payouts).
**Partial:** payout signer key handling (KMS/HSM is a Sprint 20 design item);
mainnet-scale verification; live reconciliation monitoring/alerting.
**Missing:** automated alerting on reconciliation mismatch (designed, not built).
**Before launch:** verified safety brakes (README gate), reconciliation
monitoring + payout reliability proof on mainnet, signer key hardened.
**Can wait:** higher caps (raise on evidence post-launch).
**Readiness: 75.** *(Logic strong + tested; operational hardening around it is
the gap.)*

## 3. Security
**Done:** Privy auth + embedded wallet, role-based admin (`can`/permissions),
cron auth (`CRON_SECRET`), `gitleaks` in CI, webhook signature verification,
safety brakes, append-only-style audit logs (`admin_audit_log`/`bet_audit_log`).
**Partial:** secrets management/rotation (Sprint 20 design), least-privilege
review.
**Missing:** formal secrets rotation, external pen-test / security review,
KMS/HSM for the payout signer.
**Before launch:** secrets hardening + rotation, security review, signer
isolation.
**Can wait:** advanced threat modelling iterations.
**Readiness: 60.**

## 4. Risk
**Done:** Sprint 17 risk engine — ring, arbiter/counterparty concentration,
wash, dispute abuse, velocity, behavioural sybil, supporting funding overlap;
composite + bands; cron + admin `/risk`; **shadow mode**; tested (pure + DB
isolation/false-positive guards).
**Partial:** false-positive tuning needs real-traffic data; cluster/sybil
heuristics are v1.
**Missing:** nothing required for shadow operation; enforcement wiring is
deliberately separate.
**Before launch:** run in shadow during alpha/beta; do one-off backfill sweep.
**Can wait:** threshold tuning, ML, ring-detection v2.
**Readiness: 75.** *(Complete for its shadow-mode purpose.)*

## 5. Reputation
**Done:** Sprint 15/16/16.5 — pure scoring, signals, dispute integrity factor,
arbiter reputation hardened against collusion, marketplace ranking integration,
public-safe badges (score never exposed), analytics, crons. Most mature domain;
tested.
**Partial:** backfill timing (gated tiers apply on next sweep).
**Missing:** decay/recency weighting, leaderboards (Sprint 19 design).
**Before launch:** post-deploy full recompute; nothing else.
**Can wait:** decay weighting, leaderboards.
**Readiness: 85.** *(Highest.)*

## 6. Enforcement
**Done:** Sprint 18 design (triggers, action catalog, human-gated/never-auto
rules, escalation, appeals, audit, rollout, money-path separation).
**Partial:** —
**Missing:** **all implementation** — policy engine, proposal queue, admin
console, appeals, audit tables.
**Before launch:** NOT strictly required if abuse is handled manually via
existing admin (freeze/suspend/ban) + risk alerts; enforcement automation is a
post-launch enhancement. Manual T&S playbooks (Sprint 21 L5) are the launch-time
substitute.
**Can wait:** the automated enforcement layer.
**Readiness: 15.** *(Design only — but manual moderation covers launch.)*

## 7. Social
**Done:** Sprint 19 design; profiles + public reputation badges already exist
(from S14/15).
**Partial:** public profile + badge surface partially exists.
**Missing:** follows, feeds, leaderboards, achievement badges (all design only).
**Before launch:** none — not launch-blocking.
**Can wait:** entire social layer.
**Readiness: 15.**

## 8. Growth
**Done:** Sprint 19 design (referrals permanently non-financial, etc.).
**Partial:** —
**Missing:** referral system, growth loops (design only).
**Before launch:** none — explicitly post-launch.
**Can wait:** all of it.
**Readiness: 10.**

## 9. Operations
**Done:** reconciliation cron, `freeze_state` kill-switch, advisory-locked crons
(settle/recon/auto-resolve/reputation/risk), admin app (disputes/users/finance/
payouts/freeze/risk).
**Partial:** the operational *primitives* exist, but the production operability
*around* them (Sprint 20) is design only.
**Missing:** monitoring + dashboards, alerting + on-call, tested backups/PITR
restore, DR drills, runbooks, deployment-safety pipeline (CI), load/chaos
testing, cost/capacity monitoring. **No third-party observability is wired.**
**Before launch:** monitoring + alerting (esp. reconciliation/payout), tested
backups + DR drill, runbooks, deployment safety — these are **launch-blocking**.
**Can wait:** advanced chaos game-days, full cost reporting maturity.
**Readiness: 35.** *(Biggest gap relative to its launch importance.)*

## 10. Launch
**Done:** Sprint 21 design (alpha→beta→GA stages, onboarding, Go/No-Go, kill
criteria, jurisdiction matrix, first-1000 plan).
**Partial:** —
**Missing:** execution — invite system, eligibility/geofencing gate, support
tooling additions, legal/compliance sign-off, community setup, metrics
dashboards.
**Before launch:** **all of it** by definition — especially legal/compliance
sign-off + geofencing and the Go/No-Go + kill-criteria machinery.
**Can wait:** later waves / cap increases.
**Readiness: 20.**

---

## Readiness scoreboard

| Domain | Readiness | State |
| --- | --- | --- |
| Reputation | 85 | implemented, mature |
| Product | 80 | implemented, broad |
| Money flow | 75 | implemented + tested; ops hardening pending |
| Risk | 75 | implemented (shadow), complete for purpose |
| Security | 60 | core in place; hardening/review pending |
| Operations | 35 | primitives only; observability/DR/runbooks missing |
| Launch | 20 | designed; execution + legal pending |
| Enforcement | 15 | design only (manual moderation covers launch) |
| Social | 15 | design only |
| Growth | 10 | design only |

### Total production-readiness score

Weighted toward what a **mainnet money launch** actually requires (money flow,
security and operations dominate; social/growth/enforcement carry little
launch weight):

| Domain | Score | Weight | Contribution |
| --- | --- | --- | --- |
| Money flow | 75 | 0.22 | 16.5 |
| Operations | 35 | 0.18 | 6.3 |
| Security | 60 | 0.15 | 9.0 |
| Product | 80 | 0.12 | 9.6 |
| Launch | 20 | 0.12 | 2.4 |
| Risk | 75 | 0.08 | 6.0 |
| Reputation | 85 | 0.06 | 5.1 |
| Enforcement | 15 | 0.03 | 0.45 |
| Social | 15 | 0.02 | 0.30 |
| Growth | 10 | 0.02 | 0.20 |
| **Total** | | **1.00** | **≈ 56 / 100** |

**Interpretation:** the *product and money engine are built and well-tested*
(the hard part), but the platform is **not yet launch-ready**. The gap is almost
entirely the **launch-enabling layers**: production operations (monitoring,
alerting, backups/DR, runbooks — Sprint 20) and launch execution + legal sign-off
(Sprint 21), plus security hardening. These are designed but not implemented.

## Critical path to public launch (must-have)

1. **Verify safety brakes on mainnet** (`MAX_BET`/`MAX_TVL`/freeze) — README gate.
2. **Operations (Sprint 20) implementation** — monitoring + alerting (esp.
   reconciliation + payout), tested backups + DR drill, runbooks, CI/deploy
   safety. *Largest blocking gap.*
3. **Security hardening** — secrets rotation, payout-signer isolation (KMS/HSM),
   security review.
4. **Launch execution (Sprint 21)** — eligibility/geofencing + legal sign-off,
   support tooling, Go/No-Go + kill criteria operationalized, closed alpha →
   beta.
5. **Risk in shadow + manual T&S playbooks** — sufficient for launch; automated
   enforcement deferred.

## Explicitly safe to defer (post-launch)

Automated enforcement (Sprint 18), social (Sprint 19), growth/referrals,
reputation decay/leaderboards, higher caps, advanced chaos/cost maturity.

## Out of scope (this sprint)

All implementation and code; this is an assessment document only.
