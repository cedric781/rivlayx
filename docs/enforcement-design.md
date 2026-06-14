# Sprint 18 — Enforcement Layer (Design)

> **Design only. No code, no blocks, no freezes, no payout changes, no
> settlement changes.** This document designs a *future* enforcement system that
> consumes Sprint 17 risk output (`risk_scores` + `risk_alerts`) and turns it
> into governed actions. Nothing here is implemented in this sprint.

## 0. Guiding principles

1. **Risk detects; enforcement decides; humans own the irreversible.** Sprint 17
   produces advisory signal. Enforcement adds a *decision* layer on top —
   graduated, reversible-first, and human-gated wherever an action touches money
   or is hard to undo.
2. **Money path stays sacrosanct.** Even when implemented later, enforcement
   must never *silently* alter deposits, escrow, settlement, payouts or
   balances. Money-touching actions are proposals that require explicit human
   approval and dual-control; they are recorded and reversible.
3. **Reversible before irreversible.** Always prefer the lightest action that
   mitigates the risk (watchlist → de-boost → friction → restrict → terminal).
4. **Corroboration before hard action.** A single detector firing never drives
   an account-restricting action. Hard actions require analyst confirmation
   and/or multiple corroborating signals.
5. **Everything is auditable and appealable.** Every enforcement decision (auto
   or manual) is logged immutably with its triggering evidence, and the subject
   has a defined appeal path.
6. **Kill-switch first.** Enforcement ships behind a global enable flag and a
   per-action-type switch so it can be disabled instantly without a deploy
   (reuse the `financial.freeze_state` pattern conceptually, in a separate
   `enforcement` switch table — it must never gate money components).

## 1. Which risk-events may trigger enforcement

Enforcement is **event-driven off Sprint 17 outputs**, never re-deriving risk
itself. Eligible triggers, in order of authority:

| Trigger | Source | Notes |
| --- | --- | --- |
| Analyst-confirmed alert (`status='actioned'`) | `risk_alerts` | Highest authority — a human already reviewed. Can drive hard actions. |
| Band transition into `high`/`critical` | `risk_scores.risk_band` | Drives *proposals*, not auto hard actions. |
| Corroborated detector cluster (≥2 detectors ≥ threshold) | `risk_scores.components` | Raises escalation level. |
| Confirmed ring / sybil cluster alert | `risk_alerts` (subject=cluster) | Cluster-wide proposals for all members. |

**Explicitly NOT triggers:** a single open (untriaged) alert; a `funding_overlap`
signal in isolation (supporting-only by Sprint 17 design); any score below the
`elevated` band. Untriaged alerts may only drive *monitor*-level actions.

## 2. Action catalog

Ordered lightest → heaviest. Each action has a fixed reversibility and impact
class that determines its governance (§3/§4).

| # | Action | Reversible | Touches money | Class |
| --- | --- | --- | --- | --- |
| A0 | **Monitor / watchlist add** | yes | no | observational |
| A1 | **Marketplace de-boost / hide** (ranking only) | yes | no | soft |
| A2 | **Internal flag for arbiter eligibility** (cannot be selected as arbiter) | yes | no | soft |
| A3 | **Bet-creation rate-limit / cooldown** | yes | no | friction |
| A4 | **Step-up verification required** before new bets | yes | no | friction |
| A5 | **Temporary bet/stake cap reduction** | yes | indirect (limits, not flow) | friction |
| A6 | **Withdrawal hold pending review** | yes | yes (holds, never seizes) | restrictive |
| A7 | **Account suspension** (existing `users.status='suspended'`) | yes | indirect | restrictive |
| A8 | **Component freeze** (existing `financial.freeze_state` kill-switch) | yes | yes | restrictive |
| A9 | **Account ban** (existing `users.status='banned'`) | yes* | yes | terminal |

\* A ban is operationally reversible (reinstate) but treated as terminal for
governance. No action ever *confiscates* funds — holds are released on
resolution; legitimately-owed balances remain owed.

## 3. Actions requiring human review

**All money-touching and all account-level actions require human review** (A5–A9):
- A6 withdrawal hold, A8 component freeze — review + **dual-control** (two
  distinct admins) because they touch funds.
- A7 suspension, A9 ban — review + dual-control; ban additionally requires a
  documented confirmed-fraud rationale.
- A5 cap reduction — single-admin review (reversible, no flow impact).

Human-review actions are produced by enforcement as **proposals** in a queue
(§9); they take effect only on explicit approval.

## 4. Actions that may be fully automatic

Only **reversible, low-impact, low-FP-cost, non-money** actions (A0–A2, and A3
under tight gates):
- A0 monitor / watchlist — always safe.
- A1 marketplace de-boost — reversible, no money, mirrors the existing
  reputation ranking mechanism.
- A2 arbiter-ineligibility flag — protective and reversible.
- A3 rate-limit — auto **only** at `critical` band with a corroborated signal,
  with a short TTL and automatic expiry.

Auto-actions are still logged, still appealable, and auto-expire (TTL) so a
false positive self-heals. Anything beyond A3 is never automatic in any rollout
phase of this design.

## 5. Escalation levels

| Level | Condition | Default action set | Mode |
| --- | --- | --- | --- |
| **L0 Monitor** | band `low`/`elevated`, untriaged | A0 | auto |
| **L1 Soft** | band `elevated` + ≥1 detector ≥ threshold | A0–A2 | auto |
| **L2 Friction** | band `high` corroborated (≥2 detectors) | A3–A4 auto; A5 proposal | mixed |
| **L3 Restrict** | band `critical` or confirmed ring/wash alert | A6–A8 **proposals** | human |
| **L4 Terminal** | analyst-confirmed fraud (`actioned`) + dual-control | A9 | human + dual-control |

Escalation is **monotonic and decaying**: a level is sustained only while its
condition holds; when risk subsides (Sprint 17 recompute lowers the band),
auto-actions expire and the subject de-escalates. Cluster alerts apply the level
to all members but each member keeps an individual case + appeal.

## 6. False-positive protection

Layered on top of Sprint 17's own FP guards (funding demoted, new-account
suppression, activity gate, conjunctive ring/wash gates):

1. **Corroboration requirement** — hard/restrictive actions need ≥2 detectors or
   an analyst confirmation; never one signal.
2. **Reversible-first + TTL** — auto-actions are reversible and auto-expire, so a
   wrong flag self-heals without intervention.
3. **Human gate on irreversible/money** — A5–A9 never auto.
4. **Allowlists / known-good** — verified partners, exchanges (funding), and
   high-reputation accounts get higher thresholds.
5. **Cooldown + debounce** — an account cannot oscillate; level changes require
   the condition to persist across N recomputes.
6. **Suppression feedback** — dismissed Sprint 17 alerts (and overturned
   appeals) raise the bar for re-triggering the same action on the same subject.
7. **Confidence & precision budget** — auto-action types are enabled only while
   their measured precision (from shadow mode) stays above a target; a precision
   regression auto-reverts the type to proposal-only.

## 7. Appeal flow

```
action taken ──▶ subject notified (where disclosure is safe)
                       │
                       ▼
              subject files appeal ──▶ enforcement_appeals (open)
                       │
                       ▼
        review case opened (risk evidence snapshot + action history)
                       │
        ┌──────────────┴───────────────┐
   upheld (action stands)        granted (action reversed)
        │                               │
   reason logged                 reversal logged + suppression note
                                  (dual-control for money/terminal reversals)
```

- **SLA**: appeals on money-touching/terminal actions get a defined response
  window; holds are time-boxed and auto-released if review lapses.
- **Independence**: the reviewing admin must differ from the actioning admin.
- **Outcome feeds learning**: granted appeals tighten the triggering rule and add
  a suppression note (§6.6).

## 8. Audit logging

Append-only, immutable, mirroring the existing `admin_audit_log` /
`bet_audit_log` conventions. Every decision records:
- subject (user / cluster / pair) and subject snapshot,
- trigger (alert id / band transition) + **evidence snapshot** at decision time,
- action type, mode (`auto` | `manual`), escalation level,
- actor (system or admin id; both admins for dual-control),
- reason + policy/rule id that fired,
- lifecycle: proposed → approved/rejected → applied → expired/reversed,
- linkage to any appeal and its outcome.

Logs are never mutated; corrections are new rows. This gives a complete,
defensible trail for every enforcement effect — essential before any money-path
action is ever permitted.

## 9. Admin tooling

A new **Enforcement** console (admin app), read-and-act, role-gated:
- **Proposal queue** — pending actions awaiting approval, sorted by severity,
  with the Sprint 17 evidence inline; approve/reject with reason; dual-control UI
  for A6/A8/A9.
- **Case view** — per subject: current risk scores/band, alert history, action
  timeline, appeal status.
- **Active enforcements** — what is currently in effect, with one-click reversal
  (logged) and TTL countdowns for auto-actions.
- **Appeals inbox** — independent reviewer workflow (§7).
- **Metrics** — action counts by type/level, auto vs manual split, reversal rate,
  appeal-grant rate, per-detector precision (drives §6.7).
- **Global + per-type kill-switch** — disable enforcement instantly.

## 10. Rollout strategy

Strictly staged; each stage gated on the prior stage's measured precision.

1. **Shadow / recommend-only** — enforcement computes proposals and logs
   *would-be* actions; **nothing takes effect**. Measure precision/recall vs
   analyst ground truth. (Mirrors how Sprint 17 itself rolled out.)
2. **Auto for A0–A2** — enable the reversible, non-money soft actions; monitor
   reversal/appeal rates.
3. **Auto for A3 (gated)** — short-TTL rate-limit at `critical`+corroborated only.
4. **Human-gated A5–A9 go live** — proposals routed to the queue; humans approve;
   dual-control on money/terminal. These never become automatic.
5. **Steady state** — precision budgets auto-revert any regressing auto-type to
   proposal-only; periodic policy review.

A global kill-switch and full audit trail are prerequisites for stage 2.

## 11. Actions that may NEVER be automatic

A hard, permanent list — these require a human decision in **every** rollout
phase, by design, even after enforcement is fully live:

- **A6 withdrawal hold** — touches a user's ability to access funds.
- **A8 component freeze** — touches the money path (`financial.freeze_state`).
- **A7 account suspension** and **A9 ban** — account-level, high-impact, and a
  ban implies a confirmed-fraud finding a machine must not assert alone.
- **Any action that moves, holds, reduces or reallocates funds** — there is no
  such auto-action anywhere in the catalog, and none may ever be added.
- **Any irreversible action.** If an action cannot be cleanly undone, it cannot
  be automatic.
- **Cluster-wide hard actions in one shot** — a confirmed ring still produces
  per-member proposals; bulk auto-restriction of a whole cluster is forbidden
  (one false member would be wrongly punished).

Money-touching and account-level actions (A6–A9) additionally require
**dual-control** (two distinct admins). The auto-eligible set is permanently
bounded to A0–A2 plus tightly-gated, short-TTL A3 (design §4). Anything heavier
is proposal-only forever.

## 12. Separation from the money path

Enforcement stays **structurally** separate from money — this is an
architectural guarantee, not just a policy:

1. **Read-only on risk, write-only on its own tables.** The enforcement module
   reads `risk_scores` / `risk_alerts` and writes only `enforcement_*` tables.
   It never writes `bets`, `settlements`, `payouts`, `balances`, `deposits` or
   `ledger_entries`.
2. **No imports of money-path code.** `enforcement/` does not import settlement,
   payout, escrow or balance modules. A lint/test guard (build plan §5) asserts
   this, mirroring the Sprint 17 isolation guard.
3. **Proposals, not effects.** Enforcement *emits proposals*. Any money-adjacent
   effect (A6/A8) is executed by the **existing** money-path owners (the freeze
   kill-switch, the withdrawal flow) only after explicit human approval — the
   same code paths and invariants that exist today, unchanged.
4. **No new money authority.** Enforcement introduces no new way to move funds.
   It can, at most, ask an admin to use a control that already exists.
5. **Separate kill-switch namespace.** `enforcement_switches` is distinct from
   `financial.freeze_state`; disabling enforcement can never disable a money
   safety brake, and vice-versa.
6. **Auditable boundary.** Every proposal records the exact money control it
   would invoke and who approved it — so the money path remains fully owned by
   its existing, separately-tested code, with enforcement only as an upstream
   advisor.

The money path's correctness therefore never depends on enforcement being
correct: a bug in enforcement can, at worst, surface a bad *proposal* that a
human rejects — it can never itself move money or break settlement.

## 13. Out of scope (this sprint)

- Any implementation, migration or code.
- Any actual block, freeze, limit change, payout change or settlement change.
- Auto-execution of any money-touching or account-level action (by design these
  stay human-gated even after implementation).
