# RivlayX — Public Launch Roadmap (Sprint 22)

> **Planning only. No code, no implementation.** A phased roadmap from today to
> public launch, derived from `docs/gap-analysis.md` (≈56% overall readiness)
> and `docs/launch-blockers-matrix.md` (blocker severities + resolution
> timelines). Estimates are ranges; the dominant variable is **counsel/external
> lead time**, not engineering.

## Phase model

```
Phase 0  Today (foundation)         ── internal, no money exposure to outsiders
Phase 1  Closed Alpha               ── founders/insiders, mainnet, tiny caps
Phase 2  Private Beta               ── first EXTERNAL users (invite), legal gate
Phase 3  Open Beta                  ── broader waitlist, hardened ops
Phase 4  Public Launch              ── general availability, full compliance
```

Each phase gate is health-based (Go/No-Go, Sprint 21), never calendar-based.

---

## Phase 0 — Today (foundation)

- **Goal:** lock the baseline — confirm what is built/tested and start the
  long-lead tracks (legal, security review) immediately.
- **Blockers being cleared:** none external yet; this phase *de-risks* by
  starting counsel work and verifying the core.
- **Exit criteria:** safety brakes verified on mainnet; reconciliation green on a
  live cycle; risk shadow backfill run; CI from existing husky gates; counsel +
  pen-test engagements kicked off.
- **Metrics:** 494-test suite green; reconciliation clean; brake enforcement
  confirmed.
- **Risks:** under-estimating legal lead time (mitigate: start now).
- **Rollback conditions:** n/a (no external exposure).

## Phase 1 — Closed Alpha

- **Goal:** exercise the full money lifecycle on mainnet at minimum scale with
  trusted insiders; prove reconciliation after every cycle.
- **Blockers (must clear):** safety brakes verified (#5), baseline alerting on
  reconciliation/payout/cron (#3, first cut of #6), rollback rehearsal (#10),
  kill criteria operationalized. **No legal blocker** (internal users only).
- **Exit criteria:** every lifecycle path (deposit→bet→resolve→settle→payout→
  withdraw) works end-to-end; reconciliation clean; freeze/unfreeze rehearsed; no
  open money-path defect.
- **Metrics:** lifecycle success rate, deposit-credit + payout success, recon
  freshness.
- **Risks:** mainnet-only edge cases (RPC/webhook timing); payout signer
  handling still basic.
- **Rollback conditions:** any reconciliation mismatch or payout anomaly →
  freeze-first, halt alpha, root-cause.

## Phase 2 — Private Beta (first external users)

- **Goal:** small invite waves of real external users at low caps, fully
  monitored.
- **Blockers (must clear):** **legal gate** — jurisdiction sign-off (#1),
  ToS/Privacy (#8), KYC/AML + sanctions posture (#2), geofencing enforcement
  live; plus monitoring + alerting + on-call (#6), runbooks, support tooling +
  intake + SLAs, abuse playbooks, IR process + kill criteria.
- **Exit criteria:** Go/No-Go all-green at this scale; payout/settlement SLOs
  met; abuse under control; support load sustainable; geofencing verified.
- **Metrics:** activation funnel, money reliability, dispute + risk-alert rates,
  support resolution time, retention (D1/D7), cohort health per wave.
- **Risks:** legal slippage (critical path); abuse spikes; support overload.
- **Rollback conditions:** kill criteria (Sprint 21 §13) — recon mismatch,
  payout degradation, deposit failures, support overload, alert explosion → pause
  invites + freeze affected component.

## Phase 3 — Open Beta

- **Goal:** broaden access (waitlist), raise caps on evidence, harden operations.
- **Blockers (must clear):** backups tested + DR drill (#7), security review /
  pen-test (#9), payout signer KMS/HSM (#4), load + chaos game-days, capacity +
  cost monitoring + runaway kill-switches, data-retention + audit export.
- **Exit criteria:** DR drill passes; security review remediated; SLOs hold at
  higher scale; cost/capacity within plan; cap increases stable.
- **Metrics:** all Phase 2 metrics at larger N + saturation/headroom, cost per
  settled bet, error budget burn.
- **Risks:** scale/capacity surprises; cost growth; cap increases outpacing
  reliability.
- **Rollback conditions:** SLO breach or instability → halt cap increases /
  pause waves; freeze on integrity risk.

## Phase 4 — Public Launch (GA)

- **Goal:** general availability with full compliance and scaled operations.
- **Blockers (must clear):** regulatory/licensing determination, responsible-
  gaming framework, full compliance sign-off, scaled support, mature monitoring/
  alerting + on-call rotation.
- **Exit criteria:** final Go/No-Go green; counsel sign-off for target
  jurisdictions; support + on-call staffed to volume; reconciliation +
  reliability proven across all prior waves.
- **Metrics:** steady-state SLOs, retention/growth, compliance reporting, abuse +
  cost within bounds.
- **Risks:** regulatory change; demand surge; concentrated abuse.
- **Rollback conditions:** standing kill criteria remain active permanently;
  freeze-first + reconcile on any integrity/legal event.

---

## Execution tracks

### 1. Critical path (longest, gates everything)
**Legal/compliance track →** jurisdiction classification + sign-off → ToS/Privacy
→ KYC/AML + sanctions vendor → regulatory determination. This gates **Private
Beta (external users)** and **Public Launch** and cannot be compressed by
engineering. **Start at Phase 0.** Secondary critical path: payout signer
hardening + reconciliation alerting (money integrity) for Phases 1–3.

### 2. Parallel-executable work
Engineering observability/alerting, runbooks, support tooling, geofencing
enforcement, backups/DR drills, and security pen-test can all run **in parallel**
with the legal track. None of them block closed alpha; most block private/open
beta and can be built while counsel works.

### 3. Work requiring counsel
Jurisdiction matrix sign-off, ToS + Privacy Policy, KYC/AML + sanctions posture,
regulatory/licensing, responsible-gaming framework, data-protection (GDPR/CCPA)
determinations.

### 4. Work requiring engineering
Mainnet brake verification, monitoring/alerting wiring, geofencing enforcement,
payout signer KMS/HSM integration, support tooling, CI pipeline, load/chaos
harness, capacity/cost monitoring + runaway kill-switches, audit export.

### 5. Work requiring operations
On-call rotation, runbooks, backups + PITR restore drill, DR drill, deployment-
safety process, kill-criteria operationalization, rollback rehearsals, alert
tuning, cost/capacity reporting.

### 6. Work requiring support
Support intake + SLAs + staffing, support tooling adoption, abuse-response
playbooks, community management + moderation, escalation paths to on-call.

---

## Bottom line

### Realistic launch readiness
- **Overall (toward public launch): ≈56%** (per gap analysis). Product + money +
  reputation + risk are built and tested; the launch-enabling layers
  (operations, launch execution, security hardening, legal) are largely
  designed-only.
- **Closed-alpha readiness: ≈75%** — alpha is internal and needs only
  verification + baseline alerting + rollback rehearsal on an already-tested
  core.

### Estimated time to each milestone
*(Assumes a small focused team and that counsel engagement starts at Phase 0.
Legal availability is the dominant variable.)*

| Milestone | Estimate | Gating factor |
| --- | --- | --- |
| **Closed Alpha** | **~1–2 weeks** | engineering verification + baseline alerting (no legal) |
| **Private Beta** | **~6–10 weeks** | **legal sign-off + geofencing + KYC/AML** (critical path) ∥ monitoring/support build |
| **Public Launch** | **~4–6 months** | regulatory/licensing + DR/security hardening + scaled ops, after sustained beta health |

**Key insight:** engineering can reach closed alpha quickly because the core is
solid and tested. The gap to *public* launch is dominated by the **legal/
compliance critical path** and the **operations hardening** layer — both should
start immediately and in parallel; neither is shortened by writing more product
code.

## Out of scope (this sprint)

All implementation and code; this is a planning document only. Estimates are
planning ranges, not commitments.
