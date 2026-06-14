# Sprint 24 — Operations Hardening (Design Review)

> **Review only. No code, no implementation.** Adversarial review of the Sprint 24
> design (`docs/operations-hardening-design.md` + `docs/operations-hardening-build-plan.md`),
> which closes the five Operations Review gaps against the merged Sprint 23 ops
> layer (`packages/core/src/ops/*`, `app.cron_runs` / `app.ops_alerts`,
> `/api/health` + `/api/ops/health`, the `/api/cron/ops` cycle, the admin panel).
> Locked decisions in scope: G3 `health_degraded` kept as catch-all; G4 dedicated
> `OPS_HEALTH_TOKEN`, `CRON_SECRET` never shared with vendors.

---

## 1. G1 — `cron_runs` retention / pruning

**Benefits.**
- Bounds the only unbounded ops table; removes the single real perf/storage debt
  from the Sprint 23 review.
- Zero new infra: folds a bounded delete into the already-scheduled,
  already-locked `runOpsCycle` (15 min). No `pg_cron`, no Supabase coupling.
- "Never prune the latest row per job" keeps freshness correctness intact.

**Risks.**
- **Last-row protection is the crux.** If implemented as a naive
  `DELETE … WHERE finished_at < cutoff`, a job that hasn't run within the window
  loses its only row → false `never`/stale page. The design calls this out (R1);
  correctness hinges on the `NOT (latest per job)` guard actually being in the
  delete predicate, not just prose.
- Bounded `LIMIT` batch means a large backlog drains over several cycles — the
  table stays oversized for a while after first deploy. Acceptable, worth stating
  the convergence time.
- Delete runs inside the ops advisory lock → a slow delete extends lock hold and
  could delay the alert-evaluation portion of the same cycle.

**Alternatives.**
- **Time partitioning** (monthly partitions + drop old) — cleaner at high volume,
  but infra weight not justified at Fase-1 rows; correctly deferred to post-launch.
- **`pg_cron` scheduled delete** — removes the lock-coupling risk but adds a
  Supabase-specific dependency; rejected for vendor-neutrality.
- **TTL via a separate cron** — more isolation, but a whole new cron to monitor
  (ironic for an observability sprint). The in-cycle approach is the right call.

**Implementation risk: LOW.** Single bounded delete in an existing, tested cycle.
The only sharp edge is the last-row guard; everything else is mechanical.

**Test strategy.**
- PGlite db-test: seed old + recent rows across multiple jobs → assert old pruned,
  **latest-per-job always survives** (including a job whose only row is older than
  the window → must NOT be deleted → must NOT flip to `never`).
- Batch bound respected (seed > batch, assert ≤ batch deleted per cycle).
- Money-path isolation test still green after the delete is added.

---

## 2. G2 — Runbook documentation

**Benefits.**
- Converts every alert from "a red badge" into "a red badge with a procedure" —
  the single biggest usability lift for on-call.
- The **link-integrity test** is the standout: it makes doc/anchor drift a CI
  failure, so the runbook map can't silently rot (a common ops-doc failure mode).
- Grounding each runbook in real primitives (`freeze_state`, advisory-lock
  inspection, recon auto-freeze) keeps procedures executable, not aspirational.

**Risks.**
- **Content quality is unverifiable by a test.** The link-integrity test proves an
  anchor *exists*, not that the steps are *correct or safe*. A wrong "safe manual
  run" step could cause a double-run or a bad freeze. Needs human review against
  the actual code paths.
- **Serving host is still open.** A relative `/docs/runbooks#...` only resolves if
  something serves it; if undecided at build time, links 404 in exactly the
  moment they're needed.
- Runbooks must stay in sync with money-path behaviour they describe (e.g. if
  freeze components change); the test won't catch semantic drift.

**Alternatives.**
- **Inline runbook text in the alert/dashboard** instead of links — no host
  dependency, but bloats payloads and duplicates content. Links are better.
- **External wiki (Notion/Confluence)** — discoverable but drifts from the repo
  and breaks the link-integrity guarantee. Repo-hosted markdown is the right call.

**Implementation risk: LOW (mechanical) / MEDIUM (content correctness).** Writing
the file is easy; getting the *procedures* right (especially payout/freeze/recon)
demands careful grounding and review.

**Test strategy.**
- Link-integrity unit test: every `OPS_DEFAULTS.runbooks` anchor resolves to a
  heading in `docs/runbooks.md`; fails if an alert type is added without a section.
- Manual review checklist: each runbook's "action" step cross-checked against the
  real primitive it invokes (no invented commands).

---

## 3. G3 — `health_degraded` wiring (catch-all)

**Benefits.**
- Removes dead config and adds a genuine **"unknown unknown" net**: a degraded
  roll-up that no specific rule named still pages someone.
- The "fire only when no specific spec fired" precondition is the correct design —
  it structurally prevents double-paging a named condition.
- Reuses the existing `getHealthSnapshot` roll-up, so the catch-all and the health
  endpoint share one definition of "degraded".

**Risks.**
- **Definitional overlap.** Today `getHealthSnapshot`'s degraded/down is derived
  from the *same* signals the six specific alerts use (crons, recon, freeze). So
  in practice, whenever the roll-up is non-`ok`, a specific alert almost always
  *also* fires → the catch-all may **rarely or never** trigger. Risk: it's
  correct but near-dead in practice unless a roll-up input exists that no specific
  rule covers (e.g. the `database` check — DB reachable-but-degraded — which has
  no specific alert). **That DB-only degraded case is the real justification**;
  the design should ensure the catch-all genuinely covers it.
- **Severity mapping coupling:** escalating to `critical` on roll-up `down` is
  sensible, but `down` today means "DB unreachable" — and if the DB is down, the
  ops cycle itself can't write the alert. So the most severe catch-all case is the
  one least able to self-report → reinforces that G4 (external monitor) is the
  true backstop, not G3.

**Alternatives.**
- **Remove the type** (rejected by decision) — simpler but loses the net.
- **Make `health_degraded` cover a distinct signal set** (e.g. only the
  `database` degraded check) rather than a generic "specs empty" catch-all — more
  targeted, less likely to be dead. Worth considering at build time.

**Implementation risk: LOW.** Pure addition to an already-pure evaluator. The
design risk is *semantic* (will it ever fire?), not mechanical.

**Test strategy.**
- Unit test: snapshot where roll-up is degraded via a signal **not** covered by
  the six → exactly one `health_degraded` emitted.
- Unit test: snapshot where a specific alert fires → `health_degraded` **not**
  emitted (no double-page).
- Unit test: roll-up `down` → severity `critical`.
- Confirm `evaluateOps` stays pure (no DB/clock).

---

## 4. G4 — External monitoring strategy

**Benefits.**
- Closes the **highest-severity gap**: the watcher can't watch itself. An
  independent probe on `/api/ops/health` is the only thing that survives an
  ops-cron / function / DB outage.
- **Dedicated `OPS_HEALTH_TOKEN`** is the correct security posture — a monitoring
  vendor compromise can't execute crons. Accepting the cron secret internally too
  keeps existing internal callers working (backward-compatible).
- Layered probes (`/api/health` public liveness vs token-gated readiness) is the
  textbook split.

**Risks.**
- **It's not code — it's a process/checklist item.** The strongest part of the
  sprint is the part most likely to be skipped at deploy. If the probe isn't
  actually wired, the gap remains open while *looking* closed (the token exists,
  the endpoint works, but nobody polls it). This must be an enforced launch-
  checklist gate, ideally with evidence (a screenshot/confirmation).
- **Token sprawl:** a new secret to provision, rotate, and store. Needs to join
  the secret inventory + rotation runbook (Sprint 20 §6) or it becomes an orphan.
- **Vendor still unnamed.** "Strategy only" is fine for design, but launch needs a
  concrete vendor + interval + escalation path, else there's no real pager.
- **DB-down honesty:** `/api/ops/health` returns 503 when DB is unreachable —
  good — but if the function itself can't boot, only `/api/health` (or the probe's
  own timeout) catches it. Document which failure each probe actually detects.

**Alternatives.**
- **Heartbeat/dead-man's-switch** (ops cron pings an external "if I go silent,
  page" service) — complements the pull-probe and catches the cron-silent case
  more directly. Worth adding as a follow-up; pull-probe is the right first move.
- **Self-hosted uptime checker** — avoids vendor dependency but reintroduces the
  "who watches the watcher" problem (it can fail with the same infra). External
  third-party is correct.

**Implementation risk: LOW (code) / MEDIUM (operational follow-through).** The
auth change is small; the risk is the non-code wiring not happening.

**Test strategy.**
- Endpoint auth unit test: 200/503 with valid `OPS_HEALTH_TOKEN`; 200/503 with
  cron secret; 401 with neither (in prod); public `/api/health` unaffected.
- Manual: post-deploy smoke — probe configured, fires on an induced 503, paged
  the right channel. Captured as checklist evidence.

---

## 5. G5 — Webhook payload enrichment

**Benefits.**
- Turns a page into an **actionable** page: `runbookUrl` (absolute) + `timestamp`
  + alert `id` (dashboard handle) are exactly what 03:00 on-call needs.
- Additive + backward-compatible envelope — existing consumers don't break.
- The plumbing change (`upsertOpsAlert` returns the persisted row; dispatch after
  insert) is a genuine *improvement* in correctness: the page now carries the
  real persisted id/runbook, not a pre-insert guess.

**Risks.**
- **Dispatch-after-insert reordering is the riskiest mechanical change in the
  sprint.** It moves the network call (webhook POST) to after the DB write and
  changes `runOpsCycle`'s control flow. Must preserve: dedup (no re-page on an
  existing open alert), best-effort dispatch (a failed POST never breaks the
  cycle), and auto-resolve ordering. Regression surface is the cycle test.
- **Absolute URL config (`OPS_PUBLIC_BASE_URL`) is another optional env** that, if
  unset, silently degrades to a relative (off-platform-useless) link. Fallback is
  safe but the "useful" path depends on config.
- **More internal financial detail leaves the platform** (id + runbook + the
  already-present evidence). Low delta over today, but reinforces "trusted
  destination only" — should be noted in the security/secret docs.
- Changing `upsertOpsAlert`'s return type touches its callers (cycle + any test);
  small blast radius but a typed contract change.

**Alternatives.**
- **Two-phase: insert all, then re-query new open alerts to dispatch** — avoids
  changing `upsertOpsAlert`'s signature, but adds a read and is racier. The
  return-the-row approach is cleaner.
- **Keep dispatch on specs, look up id/runbook separately** — more queries, same
  result; rejected for simplicity.

**Implementation risk: MEDIUM.** Only item that restructures `runOpsCycle`
control flow and changes a function signature. Everything else is additive.

**Test strategy.**
- db-test: full cycle → dispatched payload contains `id`, absolute `runbookUrl`,
  `timestamp`; dedup still suppresses re-page; auto-resolve unchanged.
- Unit test: `OPS_PUBLIC_BASE_URL` set → absolute URL; unset → relative fallback.
- Unit test: webhook POST throws → cycle still completes (best-effort preserved).
- Money-path isolation test still green.

---

## 6. Scores

### Production readiness score: **8.0 / 10**
Up from 7.5 (post-Sprint-23). The design is sound, additive, vendor-neutral, and
every item ships with a concrete test strategy. Not yet 9+ because (a) two items
(G2 content, G4 wiring) depend on human/process follow-through a test can't
guarantee, and (b) G5's control-flow change carries real regression surface until
implemented + verified. Score reflects *design*; realised readiness depends on
clean implementation.

### Operations maturity score: **7.0 / 10**
After Sprint 23 the system is observable; Sprint 24's design makes it
*self-sustaining* (retention), *actionable* (runbooks + enriched pages), and
*self-failure-aware* (external probe). It stops short of full maturity: no
dead-man's-switch/heartbeat, no SLO/error-budget burn alerting, no backup/DR
drills, no audit-log coverage expansion — all still in the Sprint 20 backlog.

### Remaining operations gaps (post-Sprint-24, if implemented as designed)
1. **No heartbeat / dead-man's-switch** — pull-probe catches outage; a silent
   ops-cron that returns 200 but does nothing is still a (smaller) blind spot.
2. **No SLO / error-budget alerting** — freshness thresholds exist; budget burn
   does not.
3. **Backups / DR drills, audit-log coverage, secret rotation** — Sprint 20
   backlog, untouched.
4. **`health_degraded` may be near-dead in practice** unless scoped to the
   DB-degraded case (see §3).
5. **Cost/capacity monitoring** (RPC/DB growth forecasting) — designed in Sprint
   20, not built.

### Remaining launch blockers (for the ops layer to be relied on at launch)
1. **G4 external probe actually wired** to `/api/ops/health` with `OPS_HEALTH_TOKEN`
   — checklist-enforced, with evidence. (Highest priority; non-code.)
2. **G2 runbook content reviewed for correctness/safety** (not just link-valid),
   especially payout/freeze/recon procedures.
3. **`OPS_ALERT_WEBHOOK_URL` configured + an end-to-end page verified** (carried
   over from Sprint 23 — enrichment is useless if nothing receives it).
4. **Serving host + `OPS_PUBLIC_BASE_URL`** decided so runbook links resolve
   on-platform and in the page.
5. **Uptime vendor named** + escalation path defined (no pager = no ops).

None of these are *correctness* blockers for the code; all are
config/process/content prerequisites for the layer to function in production.

---

## 7. GO / NO-GO for Sprint 24 implementation

**Decision: GO.**

The design is implementation-ready. It is additive, money-path-isolated,
vendor-neutral, and each gap has a concrete, testable acceptance bar. The two
locked decisions (G3 catch-all, G4 dedicated token) are sound.

**Implementation order (revised): G2 → G4 → G1 → G3 → G5.** G5 (webhook
enrichment) is moved to **last** because, per §5, it carries the largest
regression surface (the only item that restructures `runOpsCycle` control flow
and changes a function signature) — it must land after every other gap is in
place and green, so nothing else depends on the reordering. Proceed with these
**conditions**:

- **G1:** the last-row-per-job guard must be in the delete predicate and proven by
  a db-test (a rarely-run job must not flip to `never`).
- **G5:** treat the dispatch-after-insert reordering as the highest-risk change —
  land it with the cycle db-test extended for dedup + best-effort + payload shape
  before anything depends on it.
- **G3:** at build time, confirm the catch-all can actually fire (scope it to the
  DB-degraded case if the generic "specs empty" path proves dead).
- **G2/G4:** the non-code follow-through (runbook content review, probe wiring,
  vendor, serving host) must be tracked as launch-blocker tasks — design GO does
  **not** imply those are done.

No code may change money-path behaviour, safety brakes, or introduce non-additive
schema. Keep the 508-test suite green and the money-path isolation test as the
guardrail throughout.

**STOP — awaiting review before implementation.**
