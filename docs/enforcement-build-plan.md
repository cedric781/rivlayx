# Sprint 18 — Enforcement Layer (Build Plan)

> **Design artifact only — no code is written this sprint.** This plan describes
> *how* a future enforcement layer would be built on top of Sprint 17 risk
> output. It introduces no blocks, freezes, limit changes, payout changes or
> settlement changes. It exists so the design can be reviewed before any
> implementation sprint is scheduled.

## 1. Architecture (proposed)

A new core module `packages/core/src/enforcement/`, mirroring the pure-core +
read-only-I/O split used by `reputation/` and `risk/`. It **reads** Sprint 17
tables (`risk_scores`, `risk_alerts`) and **writes only** its own new tables. It
does not import or call settlement / payout / escrow / balance code.

```
packages/core/src/enforcement/
  types.ts        action/level/mode enums, decision shapes
  policy.ts       PURE: (risk signals + alert state) → proposed action set + level
  config.ts       thresholds, TTLs, corroboration rules, precision budgets, kill-switch
  evaluate.ts     read-only: load risk → run policy → produce proposals
  queue.ts        persist proposals (enforcement_proposals)
  apply.ts        FUTURE: apply approved actions (guarded; out of scope to implement)
  appeals.ts      appeal lifecycle
  audit.ts        append-only decision logging
  query.ts        admin reads (queue, cases, metrics)
  index.ts        exports
```

Key boundary: `policy.ts` is a **pure decision function** — unit-testable with
no DB, exactly like `risk/score.ts`. `apply.ts` is intentionally a stub in the
design; wiring it to real effects is a separate, later, opt-in sprint.

## 2. Data model (proposed — additive only, future migration 0013)

No existing table is altered; no money table is touched.

### `app.enforcement_proposals`
| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `subject_type` | varchar | user / cluster / pair |
| `subject_id` | text | |
| `action` | varchar | A0–A9 catalog (design §2) |
| `level` | varchar | L0–L4 |
| `mode` | varchar | `auto` / `manual` |
| `trigger_alert_id` | uuid null | FK → `risk_alerts` |
| `trigger_band` | varchar null | risk band at decision |
| `evidence` | jsonb | snapshot of risk components/alerts |
| `status` | varchar | proposed / approved / rejected / applied / expired / reversed |
| `requires_dual_control` | boolean | A6/A8/A9 |
| `ttl_expires_at` | timestamptz null | auto-action expiry |
| `created_at` / `updated_at` | timestamptz | |

### `app.enforcement_actions` (append-only audit ledger)
Immutable record of every state change (proposed→approved→applied→reversed),
actor(s), reason, policy/rule id, evidence snapshot. Corrections are new rows.

### `app.enforcement_appeals`
`id`, `proposal_id` (FK), `subject_id`, `status` (open/upheld/granted),
`filed_at`, `reviewed_by`, `reviewer_notes`, `resolved_at`. Reviewer must differ
from actioner.

### `app.enforcement_switches`
Global + per-action-type enable flags (kill-switch). **Never** references money
components — distinct from `financial.freeze_state`.

## 3. Reused existing primitives (no changes to them)

- **User status** (`users.status` active/suspended/banned) — A7/A9 map onto the
  existing moderation states; enforcement would *propose*, moderation *applies*.
- **`financial.freeze_state`** — A8 maps to the existing component kill-switch;
  enforcement never writes it directly, it proposes and an admin flips it.
- **`admin_audit_log`** — enforcement audit complements, not replaces, it.
- **Reputation ranking de-boost** — A1 reuses the existing marketplace ranking
  mechanism (tier-based ordering), no new money surface.

## 4. Policy engine (pure) — proposed shape

`evaluatePolicy(input)` → `{ level, proposedActions[], requiresHuman, rationale }`
where `input` carries the Sprint 17 band, per-detector sub-scores, alert states
(triaged/actioned), corroboration count and allowlist flags. Deterministic and
explainable; the mapping table is design §5. No clock, no DB.

## 5. Test plan (for the future implementation sprint)

Pure-policy unit tests (no DB):
- single open alert → only A0 (never hard actions).
- `elevated` + 1 detector → A0–A2, auto.
- `high` + 2 detectors → A3–A4 auto, A5 proposal.
- `critical` / confirmed ring → A6–A8 **proposals only**, never auto.
- analyst-`actioned` fraud → A9 proposal with dual-control flag.
- funding-overlap-only → no action above A0 (carries Sprint 17 demotion).
- **never-automatic invariant** (design §11): for any input, the policy never
  returns A5–A9 with `mode='auto'`; A6/A8/A9 always carry `requiresDualControl`.
  No money-moving auto-action exists for any input.
- de-escalation: band drops → auto-actions expire.

DB/integration tests:
- proposal dedup + lifecycle transitions; appeal grant reverses + logs.
- **isolation / money-path separation guard** (design §12): evaluating and
  queueing proposals mutates no bets/settlements/payouts/balances/deposits/ledger
  rows, and the `enforcement/` module imports no money-path code.
- audit append-only invariant (no row is ever updated in place).

False-positive fixtures: diverse whale, shared-exchange funding, family pair,
new-account burst → no action above A0.

## 6. Admin tooling (proposed)

New `/enforcement` admin pages (behind the authed shell, role-gated): proposal
queue with inline Sprint 17 evidence and approve/reject (dual-control UI for
A6/A8/A9), case view, active-enforcements with one-click reversal + TTL,
appeals inbox (independent reviewer), metrics, and the kill-switch panel.

## 7. Rollout (see design §10)

Shadow/recommend-only → auto A0–A2 → gated auto A3 → human-gated A5–A9 live →
steady state with precision-budget auto-revert. Global kill-switch + complete
audit trail are prerequisites before anything takes effect.

## 8. Out of scope (this sprint)

- All implementation, migrations and code.
- Any real block, freeze, limit change, payout change or settlement change.
- Auto-execution of money-touching or account-level actions (human-gated by
  design even after implementation).
