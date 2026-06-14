# Sprint 21 — Launch Readiness (Design)

> **Design only. No code, no implementation.** Defines how RivlayX goes from
> "Fase 1 MVP, no public users" to a controlled public launch. Per the README,
> **no public users until the safety brakes are verified** — this document makes
> that gate concrete and stages the path to the first 1000 users.
>
> ⚠️ **Legal note (§7): this is not legal advice.** The compliance checklist
> lists items that require sign-off from qualified counsel before any public
> launch in any jurisdiction.

## 0. Guiding principles

1. **Earn each expansion.** Access widens in stages (closed alpha → internal →
   beta → GA); each stage is gated on measured health, never a calendar date.
2. **Caps stay low, then rise on evidence.** Keep `MAX_BET_USDC` (25) and
   `MAX_TVL_USDC` (1000) low through alpha/beta; raise only when reconciliation,
   payout reliability and abuse rates prove it safe.
3. **Reconciliation green is non-negotiable.** No stage proceeds with an open
   ledger↔chain mismatch. On-chain remains the source of truth for funds.
4. **Containment ready.** The `freeze_state` kill-switch, Sprint 20 monitoring/
   alerting, runbooks, and tested backups must be live *before* the first
   external user.
5. **Risk-aware, human-gated enforcement.** Sprint 17 risk runs (shadow);
   Sprint 18 enforcement stays advisory/human-gated — no auto money actions.
6. **Set honest expectations.** MVP framing, responsible-gaming messaging, and
   clear limits in all user-facing comms.

## 1. Closed alpha

- **Audience**: founders + a tiny set of trusted insiders (handful of accounts).
- **Goal**: exercise the full money lifecycle on mainnet at the smallest scale —
  deposit → create/accept bet → resolve (auto/evidence/arbiter) → settle →
  payout → withdraw — and confirm reconciliation after every cycle.
- **Caps**: minimum (small stakes well under `MAX_BET_USDC`; TVL far below cap).
- **Exit criteria**: every lifecycle path works end-to-end; reconciliation clean;
  freeze/unfreeze rehearsed; no money-path defects open.

## 2. Internal testing

- **Audience**: the whole internal team + scripted scenarios.
- **Goal**: breadth + adversarial coverage — disputes, draws, expiries, evidence
  edge cases, arbiter flows, concurrent settlement, deposit dedup/replay, and
  the Sprint 20 chaos game-days against staging.
- **Validates**: idempotency/dedup invariants, advisory-lock behaviour, risk
  engine producing sane shadow output, support tooling usable for real triage.
- **Exit criteria**: chaos acceptance passes; the 494-test suite green; runbooks
  dry-run successfully; alerting fires correctly on injected faults.

## 3. Beta rollout

Two sub-phases, both invite-gated:
- **Private beta** — small invite waves; low caps; full monitoring; daily
  reconciliation + abuse review. Watch activation, deposit success, settlement/
  payout reliability, dispute + risk-alert rates per cohort.
- **Open beta** — broader invites / waitlist; caps raised in small steps only
  after sustained green metrics. Geofencing + compliance gates (§7) enforced from
  the first external user.
- **Exit criteria**: stable cohort metrics, payout SLOs met (Sprint 20 §8),
  abuse under control, support load sustainable.

## 4. User onboarding

- **Flow**: Privy email/social login → embedded Solana wallet → first deposit →
  first bet, with clear inline education (how escrow works, fees, resolution
  types, disputes, the safety caps).
- **Friction where it protects**: surface limits (`MAX_BET_USDC`) up front;
  responsible-gaming notices; jurisdiction/eligibility gate before funding.
- **Reputation context**: new users show "New" (provisional) — onboarding
  explains how trust is earned (ties to Sprint 15/19 public-safe surfaces).
- **Success metric**: deposit→first-settled-bet activation rate.

## 5. Abuse response

- **Detection**: Sprint 17 risk engine (rings, sybil, wash, dispute abuse,
  velocity) running in shadow, surfacing alerts to the admin `/risk` console.
- **Response**: triage via the (designed) Sprint 18 enforcement layer —
  reversible/auto only for soft actions; **money/account actions human-gated +
  dual-control**, freeze-first for money incidents.
- **Playbooks**: per abuse type (collusion ring, dispute spam, sybil farm),
  linked from alerts; appeals path available.
- **Feedback loop**: confirmed/dismissed outcomes tune thresholds (precision
  budget) before any enforcement automation widens.

## 6. Support tooling

- **Base**: the existing admin app (disputes, users, bets, evidence, finance,
  payouts, freeze, reputation, risk).
- **Launch additions (design)**: a support view to look up a user's account +
  public state, deposit/settlement/payout status, and open a case — **read-first,
  privileged actions audited**, never direct ledger edits. Manual money actions
  go through existing guarded flows (refund/void/payout) with audit + dual-control
  for sensitive ones.
- **Channels**: a support intake (email/form) with SLAs aligned to Sprint 20
  SLOs; escalation to on-call for money/integrity issues.

## 7. Legal / compliance checklist

> Not legal advice — every item requires qualified counsel sign-off before
> public launch. Crypto-native objective wagering is highly jurisdiction-
> dependent.

- **Jurisdictional analysis + geofencing** — where the product may operate;
  block/withhold elsewhere from the first external user.
- **Regulatory posture** — objective wagering vs gambling classification;
  licensing requirements per allowed jurisdiction.
- **KYC / AML / sanctions** — identity + sanctions screening posture; thresholds;
  crypto travel-rule considerations; custody classification.
- **Terms of Service + Privacy Policy** — published, accepted at onboarding;
  aligned with the Sprint 19 privacy rules (no score/risk/balance leakage).
- **Responsible gaming** — limits, self-exclusion, cool-off, support resources.
- **Tax + reporting** — obligations per jurisdiction.
- **Data protection** — GDPR/CCPA posture; deletion/anonymization (existing
  cascade); data-retention aligned with Sprint 20 retention policy.
- **Crypto-specific** — USDC handling, wallet custody (Privy embedded), on-chain
  transparency vs privacy.
- **Sign-off gate**: launch is blocked until counsel signs off the applicable
  subset for the target jurisdiction(s).

## 8. Launch metrics

Tracked per cohort/wave (dashboards from Sprint 20 monitoring):
- **Activation funnel**: signup → wallet → deposit → first bet → first settled.
- **Money reliability**: deposit-credit success/latency, settlement success,
  payout success/latency, withdrawal success.
- **Integrity**: reconciliation freshness/cleanliness, TVL vs cap.
- **Trust & safety**: dispute rate, risk-alert rate, confirmed-abuse rate.
- **Engagement/retention**: D1/D7/D30 retention, repeat-bet rate.
- **Ops health**: error rate, cron freshness, support volume + resolution time,
  cost per settled bet (Sprint 20 §13).

## 9. Go / No-Go criteria

A launch (and each stage gate) proceeds only if **all** hold:
- ✅ **Safety brakes verified** (per README) — caps enforced, freeze
  tested.
- ✅ Reconciliation green; no open ledger↔chain mismatch.
- ✅ Sprint 20 monitoring + alerting live; runbooks ready; backups+restore
  tested; DR drill done.
- ✅ Payout + settlement reliable at the prior stage's scale (SLOs met).
- ✅ Risk engine running; support + abuse playbooks ready.
- ✅ Legal/compliance sign-off for the target jurisdiction(s); geofencing on.
- ✅ Rollback plan rehearsed (§10).
Any ❌ ⇒ **No-Go**; fix and re-gate.

## 10. Rollback strategy

- **Instant containment**: `freeze_state` halts the affected money component;
  pause new signups/invites; app rollback on Vercel (instant).
- **Schema safety**: forward-only, backward-compatible migrations (Sprint 20
  §11) mean old + new code coexist — no destructive rollback needed.
- **Money integrity**: after any rollback, run reconciliation as the acceptance
  test before unfreezing; chain remains source of truth.
- **Comms**: pre-drafted status + user messaging; clear criteria for resuming.
- **Decision owner**: the on-call IC authorizes freeze + rollback.

## 11. Community management

- **Channels**: a primary community space (e.g. Discord) + status page;
  moderation rules and a small mod team.
- **Expectation-setting**: MVP framing, known limits/caps, responsible-gaming
  messaging, transparency about resolution + dispute processes.
- **Feedback loop**: structured bug/abuse reporting that feeds triage; changelog/
  release notes; clear escalation for money issues.
- **Trust building**: surface public-safe reputation/leaderboards (Sprint 19),
  never private data.

## 12. First 1000 users plan

- **Phased invite waves** (e.g. 50 → 150 → 300 → 500 → 1000), each wave gated on
  the Go/No-Go health metrics of the previous wave.
- **Caps rise gradually** with `MAX_TVL_USDC`/`MAX_BET_USDC` lifted in small,
  evidence-based steps as reconciliation + payout reliability hold.
- **Cohort monitoring**: track each wave's funnel, money reliability, dispute +
  abuse rates; halt/roll back a wave on regression (freeze-first).
- **Support scaling**: staff support to the wave size so resolution SLAs hold.
- **Goal**: reach 1000 healthy users with clean reconciliation, reliable payouts,
  controlled abuse, and sustainable support — the evidence base for lifting Fase
  1 caps and a wider launch.

## 13. Launch kill criteria

Hard stop conditions. If any trigger crosses its threshold, the **owner**
executes the response immediately — these are pre-authorized, not debated mid-
incident. They sit above the graduated Go/No-Go gates: a kill criterion halts an
*in-progress* rollout.

| Trigger | Threshold (halt at) | Owner | Response | Rollback action |
| --- | --- | --- | --- | --- |
| **Reconciliation mismatch** | any unexplained ledger↔chain delta | On-call IC | Page SEV1; stop all settlements/payouts | Freeze `settlements` + `withdrawals`; investigate vs chain before unfreeze |
| **Payout degradation** | payout success < 99% over 1h, or any double-pay | Payments owner | Page SEV1; halt payout cron | Freeze `withdrawals`; safe-retry per runbook; no resume until 0 anomalies |
| **Deposit failures** | deposit-credit success < 98% or webhook lag > N min | Chain/ops owner | Investigate Helius/RPC; pause new signups | Backfill webhooks; hold new deposits messaging; resume on green |
| **Support overload** | open cases > capacity SLA, or money-issue backlog | Support lead | Pause invite waves; surge staffing | Stop new-user intake; clear backlog before next wave |
| **Alert explosion** | sustained SEV1/SEV2 rate above on-call capacity | On-call IC | Triage; declare incident; pause rollout | Freeze affected component(s); roll back last deploy |
| **Infrastructure instability** | error rate / DB saturation / region outage past SLO | Ops owner | Page SEV1; engage platform DR | App rollback (Vercel) + DR runbook; freeze money path if integrity at risk |
| **Security / key compromise** | any suspected secret/signer compromise | Security owner | Page SEV1; rotate + isolate | Freeze `all`; rotate keys; reconcile before any resume |
| **TVL breach** | TVL at/over `MAX_TVL_USDC` unexpectedly | On-call IC | Investigate cap enforcement | Freeze `new_bets`; verify brake before resume |

Every kill criterion: a measurable **threshold**, a named **owner**, an
immediate **response**, and a concrete **rollback action** (almost always
freeze-first, then reconcile). Resuming requires reconciliation green + Go/No-Go
re-gate.

## 14. Jurisdiction matrix (governance)

> Operational geofencing + launch governance. **Default-deny:** a jurisdiction is
> blocked until counsel explicitly classifies it `allowed`. This is a governance
> *framework* — the actual classifications must be set/approved by qualified
> counsel (§7), not by engineering.

Each jurisdiction is classified, with the geofencing action and the basis
recorded:

| Class | Meaning | Operational action |
| --- | --- | --- |
| **Allowed** | Counsel-approved for operation | Onboarding + funding permitted; standard KYC/AML applies |
| **Blocked** | Prohibited / unacceptable risk | Geofence: block signup + funding; show ineligibility notice |
| **Legal review required** | Not yet classified / under analysis | Treated as **blocked** until reclassified; on the counsel work-list |

Governance rules:
- **Default state is `legal review required` ⇒ blocked.** New/unlisted regions
  are not accessible until explicitly allowed.
- **Single source of truth**: the matrix is a governed config (counsel-owned),
  versioned and audit-logged on change; enforced at onboarding (eligibility gate,
  §4) and continuously.
- **Per-jurisdiction fields**: class, basis/rationale, KYC/AML requirements,
  responsible-gaming requirements, effective date, approving counsel, review-by
  date.
- **Change control**: moving a jurisdiction to `allowed` is a launch-governance
  decision requiring counsel sign-off + a Go/No-Go check; demotions
  (allowed→blocked) take effect immediately (fail-safe).
- **Enforcement**: geofencing applied before funding; mismatches (e.g. VPN
  evasion) handled per abuse/compliance policy. The matrix gates access; it never
  touches the money path directly.

(Concrete country lists are intentionally omitted here — they are a
counsel-owned deliverable, populated into this framework before any public
launch.)

## 15. Out of scope (this sprint)

- All implementation and code.
- Any money-path / safety-brake / schema change.
- Final legal determinations (require external counsel).
