# RivlayX — Launch Blockers Matrix (Sprint 22)

> **Analysis only. No code, no implementation.** Enumerates every launch blocker
> across 10 categories, grounded in the Sprint 22 gap analysis (what is actually
> implemented + tested on `main` vs designed-only). For each blocker: severity,
> owner, current status, evidence of readiness, and which stage it blocks.

**Severity:** Critical (money/legal/integrity — stop) · High (operate-safely) ·
Medium (quality/scale) · Low (polish).
**Status:** ✅ implemented+tested · 🟡 partial · 📋 designed-only · ⛔ not-started.
**Blocks:** A = closed alpha · B = beta · P = public launch.

---

## 1. Money

| Blocker | Sev | Owner | Status | Evidence of readiness | A | B | P |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Safety brakes verified on mainnet (`MAX_BET`/`MAX_TVL`/freeze) | Critical | Payments/IC | 🟡 enforced in code + tests; mainnet check pending | brake logic + tests pass; `freeze_state` exists | ✓ | ✓ | ✓ |
| Reconciliation monitoring + mismatch alerting | Critical | Ops | 🟡 recon cron + `reconciliation_runs` exist; alerting missing | recon tests pass; no alert wiring | – | ✓ | ✓ |
| Payout reliability proof at scale | High | Payments | 🟡 logic + double-pay guard tested; mainnet-scale unproven | payouts tests pass | – | ✓ | ✓ |
| Payout signer key hardening (KMS/HSM + isolation) | Critical | Security | 📋 designed (S20) | design only | – | – | ✓ |

## 2. Security

| Blocker | Sev | Owner | Status | Evidence | A | B | P |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Secrets management + rotation | High | Security | 📋 designed (S20) | gitleaks in CI; rotation not built | – | – | ✓ |
| External security review / pen-test | High | Security | ⛔ not-started | none | – | – | ✓ |
| Least-privilege review (admin roles, keys) | Medium | Security | 🟡 RBAC exists; review pending | `can`/permissions tested | – | – | ✓ |

## 3. Operations

| Blocker | Sev | Owner | Status | Evidence | A | B | P |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Backups enabled + PITR restore drill | Critical | Ops | 🟡 PITR assumed on; untested restore | not verified | – | – | ✓ |
| Disaster-recovery drill (ledger rebuild vs chain) | High | Ops | ⛔ not-started | design only | – | – | ✓ |
| Runbooks (recon, payout, freeze, restore, keys) | High | Ops | 📋 designed (S20) | design only | – | ✓ | ✓ |
| Deployment safety / CI pipeline | High | Eng | 🟡 husky pre-commit gates; CI not confirmed | lint/typecheck/test run locally | – | – | ✓ |

## 4. Risk

| Blocker | Sev | Owner | Status | Evidence | A | B | P |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Risk engine running in shadow + backfill sweep | Medium | T&S | ✅ implemented; needs deploy backfill | risk tests pass; cron live | – | – | ✓ |
| False-positive tuning on real traffic | Low | T&S | 🟡 pending data | FP guards tested | – | – | – |

## 5. Legal

| Blocker | Sev | Owner | Status | Evidence | A | B | P |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Jurisdiction classification + counsel sign-off | Critical | Counsel | ⛔ framework designed; classifications not made | jurisdiction matrix (S21) | – | ✓¹ | ✓ |
| Terms of Service + Privacy Policy | Critical | Counsel | ⛔ not-started | none | – | ✓¹ | ✓ |
| KYC / AML / sanctions posture | Critical | Compliance/Counsel | ⛔ not-started | none | – | ✓¹ | ✓ |
| Responsible-gaming framework | High | Counsel/Product | ⛔ not-started | none | – | – | ✓ |
| Regulatory / licensing determination | Critical | Counsel | ⛔ not-started | none | – | – | ✓ |

¹ Required once beta admits any **external** user; an internal-only closed
alpha/beta may proceed without it.

## 6. Support

| Blocker | Sev | Owner | Status | Evidence | A | B | P |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Support tooling (case view, status lookup) | High | Support/Eng | 📋 designed (S21); admin base exists | admin app implemented | – | ✓ | ✓ |
| Support intake + SLAs + staffing | High | Support | ⛔ not-started | none | – | ✓ | ✓ |
| Abuse response playbooks (risk→manual action) | High | T&S | 📋 designed (S21 L5) | risk alerts + admin freeze/suspend exist | – | ✓ | ✓ |

## 7. Infrastructure

| Blocker | Sev | Owner | Status | Evidence | A | B | P |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Geofencing enforcement at onboarding | Critical | Eng/Compliance | ⛔ not-started | design only | – | ✓¹ | ✓ |
| Connection pool / load validated | Medium | Eng | ⛔ not-started | none | – | – | ✓ |
| Capacity + cost monitoring + runaway kill-switches | Medium | Ops | 📋 designed (S20 §13) | risk worker limits exist as example | – | – | ✓ |

## 8. Monitoring

| Blocker | Sev | Owner | Status | Evidence | A | B | P |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Monitoring + dashboards (app/DB/cron/chain) | Critical | Ops | 📋 designed; **no observability wired** | no sentry/datadog/otel in repo | – | ✓ | ✓ |
| Alerting + on-call routing | Critical | Ops | 📋 designed (S20) | none | – | ✓ | ✓ |
| Alert-volume / noise tuning | Medium | Ops | ⛔ not-started | none | – | – | ✓ |

## 9. Incident Response

| Blocker | Sev | Owner | Status | Evidence | A | B | P |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IR process + severity model + roles | High | IC/Ops | 📋 designed (S20/S21) | design only | – | ✓ | ✓ |
| Rollback rehearsal (freeze + deploy + reconcile) | High | Ops | ⛔ not-started | freeze + Vercel rollback exist | – | – | ✓ |
| Kill criteria operationalized (thresholds→on-call) | High | IC | 📋 designed (S21 §13) | design only | – | ✓ | ✓ |

## 10. Compliance

| Blocker | Sev | Owner | Status | Evidence | A | B | P |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Sanctions screening (vendor + flow) | Critical | Compliance | ⛔ not-started | none | – | – | ✓ |
| Data protection (GDPR/CCPA) + retention policy | High | Counsel/Eng | 🟡 deletion cascade exists; policy pending | FK cascade in schema | – | – | ✓ |
| Audit-log durability + export | Medium | Eng/Ops | 🟡 audit logs exist; durable export pending | `admin_audit_log`/`bet_audit_log` | – | – | ✓ |

---

## Top 10 launch blockers (sorted by risk)

Risk = severity × proximity to public launch × money/legal exposure.

| # | Blocker | Cat | Sev | Why it's top risk |
| --- | --- | --- | --- | --- |
| 1 | Jurisdiction sign-off + geofencing | Legal/Infra | Critical | External dependency (counsel); gates **any** external user; long lead time |
| 2 | KYC/AML + sanctions screening posture | Legal/Compliance | Critical | Legal exposure; needs vendor + counsel; cannot launch without |
| 3 | Reconciliation monitoring + alerting | Money/Monitoring | Critical | Money integrity blind spot — a mismatch must page instantly |
| 4 | Payout signer hardening (KMS/HSM) + reliability | Money/Security | Critical | Irreversible money movement; key compromise = catastrophic |
| 5 | Safety brakes verified on mainnet | Money | Critical | README launch gate; bounds blast radius |
| 6 | Monitoring + alerting + on-call | Monitoring/Ops | Critical | Cannot operate a money platform blind |
| 7 | Backups tested + DR drill | Ops | Critical | Unproven recovery = unacceptable for funds |
| 8 | ToS + Privacy Policy | Legal | Critical | Must be published + accepted before public users |
| 9 | External security review / pen-test | Security | High | Independent assurance before real money at scale |
| 10 | Incident response + rollback rehearsal + kill criteria | IR/Ops | High | Containment must be proven before exposure |

## Resolution timeline

### Resolvable within ~1 week (process/config/verification on existing code)
- Verify safety brakes on mainnet (#5) — logic + tests already exist.
- Risk shadow backfill sweep (run `/api/cron/risk?full=1`).
- Wire baseline alerting on reconciliation + payout + cron health (#3, #6 first
  cut) using platform metrics + a paging tool.
- Draft + dry-run runbooks; operationalize kill criteria (doc → on-call).
- Rollback rehearsal (#10) — freeze + Vercel rollback + reconcile.
- Stand up CI from the existing husky gates; confirm PITR is enabled.

### Resolvable within ~1 month (build/integration)
- Full observability + dashboards (#6) and alert tuning.
- Backups **restore drill** + DR drill (#7).
- Secrets rotation; payout signer KMS/HSM integration (#4 build).
- Support tooling + intake + abuse playbooks operational.
- Geofencing enforcement at onboarding (engineering side of #1).
- Load + chaos game-days; capacity/cost monitoring + runaway kill-switches.
- Data-retention policy + durable audit-log export.

### Requires counsel / external parties (longest lead — start now)
- Jurisdiction classification + sign-off (#1) — **counsel**.
- ToS + Privacy Policy (#8) — **counsel**.
- KYC/AML/sanctions posture + **vendor** selection (#2).
- Regulatory / licensing determination — **counsel**.
- Responsible-gaming framework — **counsel/product**.
- External security pen-test (#9) — **third-party firm**.
- (KMS/HSM provider for the payout signer — **vendor**, supports #4.)

> **Sequencing insight:** the engineering blockers (money/ops/monitoring) are
> mostly 1-week-to-1-month and build on a strong, tested core. The **critical
> path is the external/legal track** (#1, #2, #8, regulatory) — it has the
> longest lead time and cannot be compressed by engineering, so it should start
> immediately and in parallel.

## Out of scope (this sprint)

All implementation and code; this is an analysis document only.
