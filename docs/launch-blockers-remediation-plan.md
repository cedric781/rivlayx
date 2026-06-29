# RivlayX — Launch Blockers Remediation Plan (Sprint 25)

> **Planning only. No code, no implementation.** A per-blocker remediation plan
> that turns the Sprint 22 analysis into an actionable, owner-assigned, gated
> sequence toward Closed Alpha → Private Beta → Public Launch.
>
> **Sources:** `docs/gap-analysis.md` (≈56% overall readiness),
> `docs/launch-blockers-matrix.md` (severities + stages), `docs/public-launch-roadmap.md`
> (phase model + estimates), and the **Sprint 24 release review** (what S23/S24
> actually closed in the operations/monitoring layer).

## What Sprints 23–24 already changed

The matrix and gap analysis were written at Sprint 22. Sprints 23–24 moved the
**operations/monitoring** layer materially. This plan reflects the updated state:

| Item | S22 status | Now (post-S24) | Note |
| --- | --- | --- | --- |
| Reconciliation/cron alerting (in-app) | 📋 designed | ✅ built + tested | `ops` layer: detect/dedup/auto-resolve + webhook |
| Runbooks (recon/payout/freeze/cron/IR) | 📋 designed | ✅ written + link-tested | `docs/runbooks.md` (G2) |
| Deep health endpoint + auth | 🟡 shared secret | ✅ `OPS_HEALTH_TOKEN` (G4) | vendor never gets `CRON_SECRET` |
| `cron_runs` retention | ⛔ none | ✅ 30d bounded prune (G1) | self-sustaining |
| Webhook payload (id/runbook/timestamp) | 🟡 bare | ✅ enriched (G5) | actionable page |
| External observability (Sentry/Datadog/otel) | 📋 | 📋 **still none** | in-app only |
| Paging destination + on-call rotation | 📋 | ⛔ **not wired** | webhook has no receiver yet |
| External uptime probe wired | 📋 | ⛔ **deploy step open** | strategy + auth ready (G4) |

> **Net effect:** the **Operations** domain rose from ~35 (gap analysis) toward
> **~50–55** for the monitoring/alerting sub-domain. The remaining ops gaps are
> **external tooling + human process + DR**, not in-app code.

---

## Legend

- **Sev:** Critical (money/legal/integrity — stop) · High (operate-safely) · Medium · Low
- **Gate columns:** ✅ = blocks this stage · — = does not block · ✅¹ = blocks only once an **external** user is admitted
- **Ext. party:** the non-engineering dependency that sets the lead time

---

## A. Money

### A1 — Verify safety brakes on mainnet (`MAX_BET`/`MAX_TVL`/freeze)
1. **Owner:** Payments / Incident Commander
2. **Dependencies:** mainnet deploy; funded test wallet; `freeze_state` confirmed live
3. **Risk:** Critical — README launch gate; bounds blast radius. Logic + tests pass; live behaviour unverified
4. **External party:** none (engineering verification)
5. **Est. time:** ~2–3 days
6. **Alpha-gate:** ✅ · **Beta-gate:** ✅ · **Public-gate:** ✅

### A2 — Reconciliation monitoring + mismatch alerting (operational)
1. **Owner:** Ops
2. **Dependencies:** **paging destination wired to the ops webhook** (B-Mon1); one live recon cycle on mainnet
3. **Risk:** Critical — money-integrity blind spot. *In-app detection + enriched webhook now exist (S23/S24); the gap is a receiver that actually pages on-call*
4. **External party:** paging tool (PagerDuty/Opsgenie/Slack relay)
5. **Est. time:** ~2–4 days (config, given code is done)
6. **Alpha-gate:** ✅ (baseline) · **Beta-gate:** ✅ · **Public-gate:** ✅

### A3 — Payout reliability proof at mainnet scale
1. **Owner:** Payments
2. **Dependencies:** A1; live deposit→payout cycles; payout signer available
3. **Risk:** High — irreversible money movement; double-pay guard tested, scale unproven
4. **External party:** none (RPC/Helius dependency only)
5. **Est. time:** ~1 week (observation over real cycles)
6. **Alpha-gate:** — (low caps tolerate manual oversight) · **Beta-gate:** ✅ · **Public-gate:** ✅

### A4 — Payout signer key hardening (KMS/HSM + isolation)
1. **Owner:** Security
2. **Dependencies:** KMS/HSM provider selected; signer refactor to remote-sign
3. **Risk:** Critical — key compromise = catastrophic, irreversible
4. **External party:** **KMS/HSM vendor** (AWS KMS / GCP KMS / Fireblocks-class)
5. **Est. time:** ~2–4 weeks (vendor + integration + test)
6. **Alpha-gate:** — · **Beta-gate:** — (acceptable at tiny caps with tight controls) · **Public-gate:** ✅

---

## B. Operations / Monitoring / IR

### B-Mon1 — Paging destination + on-call rotation
1. **Owner:** Ops
2. **Dependencies:** ops webhook (✅ done); a paging vendor + rotation schedule
3. **Risk:** Critical — alerts exist but nothing pages a human; cannot operate money blind
4. **External party:** **paging vendor** (PagerDuty/Opsgenie) + staffed rotation
5. **Est. time:** ~3–5 days (config + rota agreement)
6. **Alpha-gate:** ✅ (baseline: even a Slack channel + named on-call) · **Beta-gate:** ✅ (formal rotation + SLA) · **Public-gate:** ✅

### B-Mon2 — External uptime probe wired to `/api/ops/health`
1. **Owner:** Ops
2. **Dependencies:** `OPS_HEALTH_TOKEN` set in prod (✅ supported, G4); pick a probe vendor
3. **Risk:** High — "who watches the watcher": ops cron can't detect its own total outage
4. **External party:** uptime vendor (Better Stack / UptimeRobot / Pingdom)
5. **Est. time:** ~1 day (pure config; verify it pages on an induced 503)
6. **Alpha-gate:** ✅ · **Beta-gate:** ✅ · **Public-gate:** ✅

### B-Mon3 — External observability (errors/traces/metrics)
1. **Owner:** Ops / Eng
2. **Dependencies:** SDK integration in `apps/web` + `apps/admin`; dashboards
3. **Risk:** High — in-app ops layer covers money signals, but no app/runtime error visibility (exceptions, latency, DB)
4. **External party:** **observability vendor** (Sentry + Datadog/Grafana/otel)
5. **Est. time:** ~1–2 weeks
6. **Alpha-gate:** — (in-app health + uptime probe suffice for tiny internal scale) · **Beta-gate:** ✅ · **Public-gate:** ✅

### B-Ops1 — Backups enabled + PITR restore drill
1. **Owner:** Ops
2. **Dependencies:** confirm PITR on the managed Postgres; staging restore target
3. **Risk:** Critical — unproven recovery is unacceptable for funds
4. **External party:** DB host (Supabase/managed PG) support if needed
5. **Est. time:** ~3–5 days (enablement + one timed restore drill)
6. **Alpha-gate:** — (verify *enabled* before alpha; full drill can trail) · **Beta-gate:** 🟡 enabled+verified · **Public-gate:** ✅ drill passed

### B-Ops2 — Disaster-recovery drill (ledger rebuild vs chain)
1. **Owner:** Ops
2. **Dependencies:** B-Ops1; documented rebuild procedure from chain + deposit signatures
3. **Risk:** High — the ledger's reconstructability claim is untested end-to-end
4. **External party:** none
5. **Est. time:** ~1 week (game-day)
6. **Alpha-gate:** — · **Beta-gate:** — · **Public-gate:** ✅

### B-Ops3 — Runbooks dry-run with on-call
1. **Owner:** Ops
2. **Dependencies:** `docs/runbooks.md` (✅ written, S24); serve from admin app
3. **Risk:** Medium — content exists + link-tested; never rehearsed against a real incident
4. **External party:** none
5. **Est. time:** ~2–3 days (table-top exercise)
6. **Alpha-gate:** 🟡 (read-through) · **Beta-gate:** ✅ (dry-run) · **Public-gate:** ✅

### B-IR1 — Rollback rehearsal (freeze → deploy → reconcile)
1. **Owner:** Ops
2. **Dependencies:** A1 (freeze verified); Vercel rollback path
3. **Risk:** High — containment must be proven before any exposure
4. **External party:** none
5. **Est. time:** ~2–3 days
6. **Alpha-gate:** ✅ · **Beta-gate:** ✅ · **Public-gate:** ✅

### B-IR2 — Kill-criteria operationalized (thresholds → on-call)
1. **Owner:** Incident Commander
2. **Dependencies:** B-Mon1; Sprint 21 §13 thresholds mapped to alert types
3. **Risk:** High — pausing/freezing decisions must be pre-agreed, not improvised
4. **External party:** none
5. **Est. time:** ~2 days (doc → on-call agreement)
6. **Alpha-gate:** ✅ · **Beta-gate:** ✅ · **Public-gate:** ✅

### B-Eng1 — CI pipeline (deployment safety)
1. **Owner:** Eng
2. **Dependencies:** existing husky lint/typecheck/test gates → CI runner
3. **Risk:** High — local gates exist; no enforced pre-merge CI
4. **External party:** CI provider (GitHub Actions)
5. **Est. time:** ~2–3 days
6. **Alpha-gate:** 🟡 · **Beta-gate:** ✅ · **Public-gate:** ✅

---

## C. Security

### C1 — External security review / pen-test
1. **Owner:** Security
2. **Dependencies:** stable beta build; scoped engagement
3. **Risk:** High — independent assurance before real money at scale
4. **External party:** **third-party security firm**
5. **Est. time:** ~3–6 weeks (scheduling + test + remediation)
6. **Alpha-gate:** — · **Beta-gate:** — · **Public-gate:** ✅

### C2 — Secrets management + rotation
1. **Owner:** Security
2. **Dependencies:** secret inventory; rotation procedure; A4 alignment
3. **Risk:** High — gitleaks catches commits, but no rotation lifecycle
4. **External party:** secrets manager (vault/cloud KMS)
5. **Est. time:** ~1 week
6. **Alpha-gate:** — · **Beta-gate:** 🟡 · **Public-gate:** ✅

### C3 — Least-privilege review (admin roles, keys)
1. **Owner:** Security
2. **Dependencies:** RBAC (`can`/permissions) exists + tested
3. **Risk:** Medium — review pending, not a build
4. **External party:** none
5. **Est. time:** ~2–3 days
6. **Alpha-gate:** — · **Beta-gate:** 🟡 · **Public-gate:** ✅

---

## D. Legal / Compliance *(critical path — longest lead, start immediately)*

### D1 — Jurisdiction classification + counsel sign-off
1. **Owner:** Counsel
2. **Dependencies:** jurisdiction matrix (S21, exists); target-market decision
3. **Risk:** Critical — gates **any** external user; cannot be compressed by engineering
4. **External party:** **outside counsel**
5. **Est. time:** ~4–8 weeks
6. **Alpha-gate:** — (internal only) · **Beta-gate:** ✅¹ · **Public-gate:** ✅

### D2 — Terms of Service + Privacy Policy
1. **Owner:** Counsel
2. **Dependencies:** D1; product surface frozen enough to describe
3. **Risk:** Critical — must be published + accepted before external users
4. **External party:** **counsel**
5. **Est. time:** ~3–5 weeks (overlaps D1)
6. **Alpha-gate:** — · **Beta-gate:** ✅¹ · **Public-gate:** ✅

### D3 — KYC / AML / sanctions posture
1. **Owner:** Compliance / Counsel
2. **Dependencies:** D1; vendor selection + onboarding-flow integration
3. **Risk:** Critical — legal exposure; cannot admit external money without it
4. **External party:** **KYC/AML + sanctions-screening vendor** + counsel
5. **Est. time:** ~4–8 weeks (vendor + integration)
6. **Alpha-gate:** — · **Beta-gate:** ✅¹ · **Public-gate:** ✅

### D4 — Geofencing enforcement at onboarding
1. **Owner:** Eng / Compliance
2. **Dependencies:** D1 (which regions); onboarding gate implementation
3. **Risk:** Critical — engineering side of the legal gate; designed only
4. **External party:** geo-IP provider (counsel defines the blocklist)
5. **Est. time:** ~1 week (engineering), gated by D1 timing
6. **Alpha-gate:** — · **Beta-gate:** ✅¹ · **Public-gate:** ✅

### D5 — Regulatory / licensing determination
1. **Owner:** Counsel
2. **Dependencies:** D1–D3 outcomes
3. **Risk:** Critical — determines whether/where GA is permitted
4. **External party:** **counsel / regulators**
5. **Est. time:** ~months (jurisdiction-dependent)
6. **Alpha-gate:** — · **Beta-gate:** — · **Public-gate:** ✅

### D6 — Responsible-gaming framework
1. **Owner:** Counsel / Product
2. **Dependencies:** D5 direction
3. **Risk:** High — required for compliant GA
4. **External party:** counsel / RG specialist
5. **Est. time:** ~2–4 weeks
6. **Alpha-gate:** — · **Beta-gate:** — · **Public-gate:** ✅

### D7 — Data protection (GDPR/CCPA) + retention policy
1. **Owner:** Counsel / Eng
2. **Dependencies:** deletion cascade exists (FK); policy + audit-export pending
3. **Risk:** High — policy + durable export not done
4. **External party:** counsel
5. **Est. time:** ~2–3 weeks
6. **Alpha-gate:** — · **Beta-gate:** 🟡 · **Public-gate:** ✅

---

## E. Support

### E1 — Support tooling (case view, status lookup)
1. **Owner:** Support / Eng
2. **Dependencies:** admin app base exists (✅); add case/status views
3. **Risk:** High — needed before external users generate tickets
4. **External party:** none
5. **Est. time:** ~1–2 weeks
6. **Alpha-gate:** — · **Beta-gate:** ✅ · **Public-gate:** ✅

### E2 — Support intake + SLAs + staffing
1. **Owner:** Support
2. **Dependencies:** E1; channel + rota
3. **Risk:** High — support overload is a Sprint 21 kill-criterion
4. **External party:** support staff / help-desk tool
5. **Est. time:** ~1–2 weeks
6. **Alpha-gate:** — · **Beta-gate:** ✅ · **Public-gate:** ✅

### E3 — Abuse-response playbooks (risk → manual action)
1. **Owner:** Trust & Safety
2. **Dependencies:** risk alerts + admin freeze/suspend exist (✅); playbook doc
3. **Risk:** High — manual moderation is the launch-time substitute for automated enforcement
4. **External party:** none
5. **Est. time:** ~3–5 days
6. **Alpha-gate:** — · **Beta-gate:** ✅ · **Public-gate:** ✅

---

## F. Infrastructure / Scale *(mostly public-gate)*

### F1 — Connection pool / load validated
1. **Owner:** Eng · 2. **Deps:** load harness · 3. **Risk:** Medium · 4. **Ext:** none
5. **Est.:** ~1 week · 6. Alpha — · Beta — · **Public ✅**

### F2 — Capacity + cost monitoring + runaway kill-switches
1. **Owner:** Ops · 2. **Deps:** observability (B-Mon3) · 3. **Risk:** Medium · 4. **Ext:** observability vendor
5. **Est.:** ~1 week · 6. Alpha — · Beta — · **Public ✅**

### F3 — Audit-log durability + export
1. **Owner:** Eng / Ops · 2. **Deps:** audit logs exist (✅); durable export · 3. **Risk:** Medium · 4. **Ext:** none
5. **Est.:** ~3–5 days · 6. Alpha — · Beta — · **Public ✅**

---

## Gate summary (what blocks each stage)

| Stage | Blockers that gate it |
| --- | --- |
| **Closed Alpha** (internal, mainnet, tiny caps) | A1, A2 (baseline), B-Mon1 (baseline), B-Mon2, B-IR1, B-IR2 |
| **Private Beta** (first external users) | + D1, D2, D3, D4 (legal gate); A3; B-Mon1 (formal), B-Mon3, B-Ops1, B-Ops3, B-Eng1; E1, E2, E3 |
| **Public Launch** (GA) | + A4; B-Ops2; C1, C2, C3; D5, D6, D7; F1, F2, F3 |

---

## Fastest path to **Closed Alpha** — ~1–2 weeks (no legal)

All engineering/ops verification on an already-tested core. Parallelizable:

1. **A1** — verify safety brakes on mainnet (2–3 d).
2. **B-Mon1 (baseline)** — point the ops webhook at a real channel + name an on-call (2 d).
3. **B-Mon2** — set `OPS_HEALTH_TOKEN` + wire the external uptime probe; induce a 503 to confirm it pages (1 d).
4. **A2** — run one live recon cycle; confirm a synthetic drift pages (2 d, after B-Mon1).
5. **B-IR1 + B-IR2** — rollback rehearsal + kill-criteria → on-call agreement (3 d).
6. **B-Ops1 (verify enabled)** + read-through of `docs/runbooks.md`; confirm CI (B-Eng1) (parallel).

**Critical chain:** A1 → A2 ↔ B-Mon1 → B-IR1/B-IR2. **Gate:** Go/No-Go green at tiny internal scale.

## Fastest path to **Private Beta** — ~6–10 weeks (legal = critical path)

Engineering finishes in ~2–3 weeks; **the wall is the legal track**, so start it on day 1 and build in parallel.

- **Day 1 (parallel, long-lead):** kick off **D1** (jurisdiction sign-off), **D2** (ToS/Privacy), **D3** (KYC/AML + sanctions vendor). These set the 6–10-week floor.
- **Engineering ∥ (weeks 1–3):** **D4** geofencing (gated by D1's region list), **B-Mon3** observability, **B-Ops1** restore drill, **B-Ops3** runbook dry-run, **B-Eng1** CI, **A3** payout reliability over real cycles.
- **Support ∥ (weeks 1–3):** **E1** tooling, **E2** intake/SLA, **E3** abuse playbooks.

**Critical chain:** D1 → (D2, D3, D4) → external admit. **Gate:** legal sign-off received **and** monitoring/support/IR all green; Go/No-Go at low external caps.

## Fastest path to **Public Launch** — ~4–6 months

Gated by regulatory determination + DR/security hardening + sustained beta health.

- **Long-lead (start during beta):** **D5** regulatory/licensing, **C1** external pen-test (schedule early), **A4** signer KMS/HSM (vendor), **D6** responsible-gaming, **D7** data-protection policy.
- **Hardening ∥:** **B-Ops2** DR drill, **C2/C3** secrets rotation + least-privilege, **F1/F2/F3** load/cost/audit-export.
- **Evidence gate:** sustained Private-Beta health (recon clean, SLOs met, abuse contained) across waves before raising caps to GA.

**Critical chain:** D5 (regulatory) + C1 (pen-test remediation) + A4 (signer) → final Go/No-Go. **Engineering cannot compress D5.**

---

## Bottom line

- **Closed alpha is close (~1–2 wk):** S23/S24 already delivered in-app alerting,
  runbooks, health-endpoint auth, and retention — alpha now needs only
  **verification + a paging receiver + an uptime probe + rehearsals**, no new
  product code.
- **Private beta is legal-bound (~6–10 wk):** every engineering/ops/support item
  fits inside the legal lead time, so the only way to go faster is to **start
  counsel + KYC/AML vendor selection immediately**.
- **Public launch is ~4–6 months:** dominated by regulatory determination,
  security review, signer hardening, and proven DR — none compressible by
  writing product code.

## Out of scope (this sprint)

All implementation and code; this is a planning document only. Estimates are
planning ranges, not commitments. Deferred per gap analysis: automated
enforcement (S18), social (S19), growth/referrals, reputation
decay/leaderboards, higher caps.
