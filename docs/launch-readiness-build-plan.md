# Sprint 21 — Launch Readiness (Build Plan)

> **Design artifact only — no code, no implementation this sprint.** Sequences
> the path from "no public users" to the first 1000, per
> `docs/launch-readiness-design.md`. Most work is process, gating and
> verification, plus modest (designed, not built) support-tooling additions. No
> money-path, safety-brake or schema change.

## 1. Workstreams (proposed)

| # | Workstream | Nature | Gate it serves |
| --- | --- | --- | --- |
| L1 | Closed-alpha runbook + checklist | process | full lifecycle verified |
| L2 | Internal test plan + chaos game-days | process (Sprint 20 §10) | breadth/adversarial |
| L3 | Beta invite system + waves | minor tooling (invite gating) | staged access |
| L4 | Onboarding flow + eligibility/geofence gate | UX + compliance | activation + lawful access |
| L5 | Abuse playbooks (risk→enforcement) | process | T&S response |
| L6 | Support tooling additions | minor admin code (read-first, audited) | support SLAs |
| L7 | Legal/compliance checklist + counsel sign-off | external/process | lawful launch |
| L8 | Launch metrics dashboards | observability (Sprint 20) | Go/No-Go evidence |
| L9 | Go/No-Go gate definition | process | every stage |
| L10 | Rollback rehearsal | process (freeze + Vercel + reconcile) | containment |
| L11 | Community setup + moderation | process | expectations/trust |
| L12 | First-1000 wave plan + cohort monitoring | process | controlled growth |
| L13 | Launch kill criteria (pre-authorized stops) | process | in-flight halt |
| L14 | Jurisdiction matrix (counsel-owned, default-deny) | governance/process | lawful geofencing |

Guard: nothing here changes money-path behaviour, the safety brakes
(`MAX_BET_USDC`/`MAX_TVL_USDC`) or schemas. Cap *values* may be tuned via config
under Go/No-Go gating, not via code/logic change.

## 2. Dependencies

- **Sprint 20 prerequisites** (monitoring, alerting, backups+restore, DR drill,
  runbooks, deployment safety, cost/capacity) must be live before L1 external
  exposure.
- **Sprint 17 risk** running (shadow) for L5; **Sprint 18 enforcement** stays
  advisory/human-gated.
- **Sprint 19 social** public-safe surfaces optional for L11 (no private data).

## 3. Support tooling additions (proposed, minimal)

Extend the admin app with a **support case view**: user lookup + public state,
deposit/settlement/payout status, open/track a case. **Read-first; privileged
actions reuse existing guarded flows (refund/void/payout) with audit + dual-
control for sensitive ones.** No direct ledger edits, no new money authority.

## 4. Go/No-Go gate (process, not code)

A checklist evaluated before each stage (design §9): safety brakes verified,
reconciliation green, Sprint 20 ops live, payout/settlement SLOs met, risk +
support + abuse playbooks ready, legal sign-off + geofencing, rollback rehearsed.
Owned by the on-call IC; any ❌ blocks the stage.

## 5. Test / validation plan

- **Lifecycle verification** (L1): every money path completes + reconciles on
  mainnet at minimal scale.
- **Chaos acceptance** (L2): Sprint 20 invariants hold under fault injection.
- **Onboarding/geofence** (L4): ineligible jurisdictions blocked before funding.
- **Support tooling**: privileged actions audited; no direct ledger mutation
  (isolation guard); read paths leak no score/risk/balance.
- **Rollback drill** (L10): freeze → rollback → reconcile passes.
- No regression to the existing 494-test suite for any support-tooling code.

## 6. Rollout order (proposed)

1. L7 legal checklist kicked off early (longest external lead time) + L8 metrics.
2. L1 closed alpha → L2 internal testing.
3. L6 support tooling + L5 abuse playbooks + L9 Go/No-Go + L10 rollback rehearsal.
4. L3 beta invites + L4 onboarding/geofence → private then open beta.
5. L11 community + L12 first-1000 waves, caps raised on evidence.

## 7. Out of scope (this sprint)

- All implementation and code.
- Any money-path / safety-brake / schema change.
- Final legal determinations (external counsel).
