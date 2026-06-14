# Sprint 17 — Risk Engine (Design)

> **Shadow mode. Read-only.** This system observes, analyses, scores, monitors
> and alerts. It does **not** block, freeze, change limits, stop payouts or
> influence settlements. It never touches deposits, escrow, settlement, payouts,
> balances or any money flow. Its only writes are to its **own** new tables.

## 0. Guiding principles

1. **Detect, never enforce.** Output is advisory signal for human review (T&S).
   No automatic action exists in this sprint. Enforcement is explicitly a
   *future* sprint, gated on a measured false-positive rate.
2. **Money-path untouched.** No edits to `bets` / `settlements` / `payouts` /
   `balances` / `deposits` logic, and — deliberately — **no enqueue hooks inside
   the money-path transactions**. The engine discovers work itself by scanning
   existing timestamps (`bets.updated_at`, `disputes`, `deposits.detected_at`).
   See §6. This keeps `settle.ts` / `dispute.ts` / deposit code byte-for-byte
   unchanged.
3. **Explainable, not magic.** Deterministic heuristics only — no ML, no
   black box. Every score persists its `components` + per-alert `evidence` so an
   analyst can see *why* something fired.
4. **Funding overlap is never a primary factor.** It is a *supporting* signal
   only, hard-capped and gated (§4.7). Exchanges, families, friends and shared
   custodial wallets must not, on their own, produce risk.
5. **Pure core, I/O at the edge.** Scoring is a pure function (`score.ts`):
   signals in → scores/bands out. Graph building and signal gathering are
   isolated read-only queries. Fully unit-testable without a DB.

## 1. Available signals (what we actually have today)

| Source table | Columns we read (read-only) | Used by |
| --- | --- | --- |
| `app.bets` | `creator_user_id`, `acceptor_user_id`, `stake_per_side_usdc`, `status`, `template_id`, `created_at`, `updated_at`, `arbiter_type` | ring, concentration, wash, velocity, sybil |
| `app.bet_arbiters` | `arbiter_user_id`, `bet_id`, `decision`, `selected_by` | ring (arbiter overlap) |
| `app.disputes` | `opener_user_id`, `bet_id`, `claimed_winner_user_id`, `status` | dispute abuse |
| `app.settlements` | `winner_user_id`, `loser_user_id`, `bet_id` | wash (net exposure) |
| `auth.users` | `id`, `username`, `created_at`, `status` | sybil (bursts, name patterns) |
| `auth.wallets` | `user_id`, `address` | funding overlap (supporting) |
| `financial.deposits` | `user_id`, `source_wallet`, `amount_usdc`, `detected_at` | funding overlap (supporting) |
| `app.user_reputation` | `tier`, `components` (frivolous/adverse) | dispute abuse cross-check |

Everything above is already indexed on the join keys we need
(`bets_creator_idx`, `deposits_user_idx`, `deposits_source_idx`,
`users_status_idx`, FK indexes on arbiter/dispute `bet_id`).

## 2. Out-of-bounds signals (deliberately excluded)

- **No device fingerprinting.**
- **No IP tracking.**
- **No KYC / identity data.**

These are excluded for privacy reasons and because they fall outside the current
data model. Sybil detection is therefore *behavioural*, not identity-based.

## 3. The detectors

### 3.1 Ring detection → `ring_score`, `ring_cluster_id`

Build a **counterparty graph** over matched bets (`acceptor_user_id IS NOT
NULL`). Nodes = users; an undirected edge (A,B) carries:

- `shared_bets` — count of bets where {creator,acceptor} = {A,B}
- `shared_volume_usdc` — Σ `stake_per_side_usdc` on those bets
- `shared_arbiter_bets` — count where the bet's arbiter is also in {A,B} or the
  same cluster

Detect the shapes the spec calls out:

```
A ↔ B          (reciprocal pair)
A ↔ B ↔ C      (chain / triangle)
A ↔ B ↔ C ↔ D  (closed cluster)
```

Per connected component (`cluster_id`) and per member, measure:

- **cohesion** = internal edge weight ÷ total incident edge weight
  (a *closed* cluster → near 1.0; an open, well-connected user → low).
- **repeatedCounterpartyRatio** = share of a user's matched volume concentrated
  on its top-k counterparties.
- **arbiterOverlap** = fraction of a user's ruled bets whose arbiter is in the
  same cluster (collusion triangle creator↔acceptor↔arbiter).

```
ringSignal = clamp(0.40·cohesion + 0.30·repeatedCounterpartyRatio
                   + 0.30·arbiterOverlap, 0, 1)
ring_score = round(100 · ringSignal)
```

`arbiterOverlap` here is reinforced by the arbiter-concentration signal (§3.1b):
a cluster whose rulings funnel to one arbiter scores higher on ring overlap.

Gated by `minClusterActivity` (min shared bets + min shared volume) so a single
low-stake bet between two friends is **not** a ring.

### 3.1b Arbiter concentration → `arbiter_concentration_score`

A collusion-specific concentration signal: does activity funnel to one friendly
adjudicator? Measured over `app.bet_arbiters` joined to `app.bets`:

- **creatorArbiterShare** — for each creator, the max share of their bets routed
  to a single arbiter (one creator → one captive arbiter).
- **acceptorArbiterShare** — same, per acceptor.
- **clusterArbiterShare** — within a ring cluster (§3.1), the max share of the
  cluster's *rulings* performed by a single arbiter.

```
arbiterConcentrationSignal = clamp(0.35·creatorArbiterShare
                                  + 0.25·acceptorArbiterShare
                                  + 0.40·clusterArbiterShare, 0, 1)
arbiter_concentration_score = round(100 · arbiterConcentrationSignal)
```

Gated by a minimum ruled-bet count so a new user with one ruled bet (trivially
100% one arbiter) does not flag — concentration is only meaningful with volume.

This signal feeds **two** places (per spec): it augments the `arbiterOverlap`
term inside **ring detection** (§3.1), and it is its own weighted term in the
**risk score** composite (§4.2). The user-selected vs platform-selected
distinction matters: rulings by **platform-selected** arbiters (vetted) do not
count toward concentration — only user-selected routing is suspicious.

### 3.2 Counterparty concentration

A Herfindahl–Hirschman style index over a user's counterparties by volume:

```
HHI = Σ (volume_with_cp_i / total_volume)²      ∈ (0, 1]
concentrationSignal = clamp((HHI − floor) / (1 − floor), 0, 1)
```

HHI ≈ 1 → all activity funnels through one party (alt-loop). Distinct, spread
counterparties → low. (`floor` removes credit for naturally low-N new users.)

### 3.3 Wash trading → `wash_score`

For each canonical pair (A,B) with reciprocal activity (A creates/B accepts
**and** B creates/A accepts):

- **roundTrips** = min(directional matched counts) — reciprocity strength.
- **netExposureRatio** = |Σ signed settled P&L between the pair| ÷ Σ gross
  volume between the pair. Money that just circles → net ≈ 0.
- **repeatedVolume** = total reciprocal settled volume (log-normalised).

```
washSignal = clamp(reciprocity · (1 − netExposureRatio) · volumeWeight, 0, 1)
wash_score = round(100 · washSignal)
```

High round-trips **and** near-zero net exposure **and** meaningful volume → wash.
Any one alone is insufficient (a single lost rematch is not wash).

### 3.4 Dispute abuse → `abuse_score`

Reuses the dispute classification already proven in reputation, at finer grain:

- **frivolousRate** = rejected disputes opened ÷ disputes opened (Laplace
  smoothed).
- **excessDisputeRate** = disputes opened ÷ matched bets, relative to platform
  baseline (disproportionate volume of disputes).
- **patternConcentration** = disputes repeatedly aimed at the same counterparty
  or arbiter (harassment / grinding pattern).

```
abuseSignal = clamp(0.45·frivolousRate + 0.30·excessDisputeRate
                   + 0.25·patternConcentration, 0, 1)
abuse_score = round(100 · abuseSignal)
```

### 3.5 Velocity anomaly → `velocity_score`

Compare a **recent window** (24h / 7d) against the user's own **trailing
baseline** (30d median) on three axes:

- bet frequency spike
- volume spike
- stake-size escalation

```
velocitySignal = clamp(max(freqSpike, volumeSpike, stakeSpike) normalised, 0, 1)
velocity_score = round(100 · velocitySignal)
```

**New-account suppression:** users with insufficient baseline history produce
*no* velocity signal (onboarding ramp-up is not an anomaly). See §7.

### 3.6 Sybil detection (behavioural)

Cluster candidates by behavioural similarity (no identity data):

- **creation bursts** — many `auth.users` created in a tight window.
- **username patterns** — structural similarity (shared prefix/suffix,
  sequential numeric tails) via the existing username format constraint.
- **stake similarity** — repeated identical `stake_per_side_usdc`.
- **template similarity** — repeated identical `template_id` / bet shape.
- **repeated behaviour** — near-identical activity timing/cadence.

Sybil output is a **cluster** (`sybil_cluster_id`, `confidence`,
`signals_hit[]`) and primarily fuels the *ring* and *concentration* signals plus
its own `sybil_alert`. It is intentionally cautious — behavioural-only sybil
detection is noisy, so it raises alerts for review rather than feeding the
composite heavily.

### 3.7 Funding overlap (supporting signal only)

Distinct users sharing a `financial.deposits.source_wallet` (read-only) or a
linked `auth.wallets.address`. This is the classic false-positive trap:

- centralised **exchange** withdrawal wallets fund thousands of unrelated users,
- **families / friends / shared custodial wallets** legitimately overlap.

Therefore funding overlap is **never** a primary factor. It only acts as a small
booster on an *already-elevated* primary score (§4.7), is hard-capped at +5
points, and a configurable **allowlist of known exchange/custodial source
wallets** is excluded entirely.

## 4. Scoring model

### 4.1 Priority order (per spec)

1. Ring detection
2. Arbiter concentration
3. Counterparty concentration
4. Wash trading
5. Dispute abuse
6. Velocity anomalies
7. Funding overlap — *supporting only, never primary*

### 4.2 Primary composite

Each sub-signal is normalised to [0,1]. The primary composite weights them in
the priority order above and **sums to 1.0**:

```
primary = 0.28·ringSignal
        + 0.16·arbiterConcentrationSignal
        + 0.16·concentrationSignal
        + 0.16·washSignal
        + 0.14·abuseSignal
        + 0.10·velocitySignal
```

### 4.3 Funding overlap booster (gated + capped)

```
fundingBoost = (primary ≥ 0.40) ? min(0.05, 0.05·fundingSignal) : 0
```

- Applies **only** when a primary signal already reaches ELEVATED (≥ 0.40).
- Caps at **+0.05** (5 points). Funding overlap alone can therefore never even
  reach the LOW band — it can only nudge an already-suspicious account.

### 4.4 Final risk score

```
risk_score = round(100 · clamp(primary + fundingBoost, 0, 1))
```

### 4.5 Bands (per spec)

| Score | Band |
| --- | --- |
| 0–19 | `none` |
| 20–39 | `low` |
| 40–59 | `elevated` |
| 60–79 | `high` |
| 80–100 | `critical` |

**No automatic actions at any band.** The band drives alert severity and admin
sorting only.

### 4.6 Minimum-activity gate

Like reputation's "provisional", a user below a minimum activity floor (matched
bets / age) cannot exceed the `low` band. Thin accounts have too little evidence
to be flagged HIGH/CRITICAL — this is a core false-positive guard.

### 4.7 Independent alerts

Each detector also raises its **own** alert whenever its sub-score crosses a
per-detector threshold, *independent of the composite*. A clean-composite user
who nonetheless shows a strong wash pattern still produces a `wash_trade_alert`
for review. The composite is for ranking; the per-detector alerts are for
catching specific behaviours.

## 5. Alert types

| Type | Subject | Trigger |
| --- | --- | --- |
| `ring_alert` | cluster | `ring_score` ≥ threshold + cluster size/volume |
| `sybil_alert` | cluster | sybil confidence ≥ threshold |
| `wash_trade_alert` | user / pair | `wash_score` ≥ threshold |
| `dispute_abuse_alert` | user | `abuse_score` ≥ threshold |
| `velocity_alert` | user | `velocity_score` ≥ threshold |
| `high_risk_user` | user | composite band ≥ `high` |

Alerts dedup on `(subject_type, subject_id, type)` while `status = 'open'`.
Lifecycle: `open → triaged → (dismissed | actioned)`. Dismissed alerts feed a
suppression list to reduce repeat noise (§7).

## 6. Compute flow (read-only, no money-path hooks)

The engine is **self-driven** — it does **not** add enqueue calls inside
settlement/dispute/deposit transactions (which would be a money-path code
change). Instead:

- **Incremental scan** (frequent cron): find users with activity since the last
  run using existing timestamps (`bets.updated_at`, `disputes`,
  `deposits.detected_at`), enqueue them into `risk_recompute_queue`, then drain:
  gather signals → score → upsert `risk_scores` → raise/refresh alerts.
- **Full sweep** (nightly cron): rebuild the `risk_edges` graph from scratch,
  recompute clusters and every user's score. Doubles as backfill.

`risk_recompute_queue` is a **work queue populated by the scanner**, not an
outbox fed from money-path transactions.

## 7. False-positive strategy

This is the heart of the design — in shadow mode, precision matters more than
recall, because every false flag erodes analyst trust.

1. **Funding overlap demoted** — never primary, capped +5, gated on an
   already-elevated primary, exchange/custodial allowlist excluded.
2. **New-account suppression** — no velocity baseline ⇒ no velocity signal;
   thin accounts capped at `low` (§4.6).
3. **Conjunctive ring/wash gates** — a flag needs *cohesion + repetition +
   volume* together, never a single weak edge. Small low-stake friend pairs stay
   below threshold.
4. **Per-detector thresholds tuned conservatively** for shadow mode; all live in
   `config.ts` for tuning without code change.
5. **Human-in-the-loop** — every output is advisory; nothing acts automatically.
6. **Explainability** — `risk_scores.components` + `risk_alerts.evidence` store
   the inputs behind each verdict so analysts can confirm/dismiss quickly.
7. **Suppression feedback** — dismissed alerts are remembered; the same subject
   does not re-alert for the same reason without a material change.
8. **Precision metrics** — track triage outcomes (dismissed vs actioned) per
   detector to measure the false-positive rate before any future enforcement.

## 8. Visibility matrix

| Field | Public | Admin / T&S |
| --- | --- | --- |
| `risk_score`, sub-scores, bands | ❌ never | ✅ |
| `risk_alerts`, evidence | ❌ never | ✅ |
| ring / sybil cluster membership | ❌ never | ✅ |

Risk data is **strictly internal**. No public API, badge or marketplace signal
exposes it. (Contrast reputation, which exposes only `tier`/`provisional`.)

## 9. Explicitly out of scope (this sprint)

- Any automatic enforcement (block / freeze / limit / payout-stop / settlement
  influence).
- Any change to deposits, escrow, settlement, payouts, balances, money flow.
- Device fingerprinting, IP tracking, KYC.
- ML / statistical models — deterministic heuristics only.
- Public exposure of any risk signal.

## 10. Decisions

- Funding overlap is supporting-only and hard-capped — the single most important
  false-positive guard.
- Self-driven scanner (no money-path enqueue hooks) to guarantee the money path
  is untouched.
- Pure scoring core mirrors the reputation module so fraud scenarios are unit
  tested without a DB.
- Shadow mode first; enforcement is a separate, later, opt-in decision.
