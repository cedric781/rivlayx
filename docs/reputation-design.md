# Sprint 15 — Reputation System (Design)

> Status: **design / awaiting review**. No code yet.
> Goal: a reusable trust score that Marketplace, Profiles, future Leaderboards
> and future Trust & Safety can all read from a single source of truth.

## 0. Guiding principle

Reputation measures **reliability and trustworthiness, not skill**. A user who
wins often is not inherently more trustworthy, and win-rate is partly
manipulable (self-dealing) — so it is kept to a **small ≤5% influence**, never a
driver. The point of including it at all: **extreme outcomes carry a weak
signal** (a long, consistent track record nudges up; chronic extreme results are
worth a small nudge and an internal anomaly flag). Skill *ranking* still belongs
to a future leaderboard, not to reputation.

The single largest threat is **wash trading / self-dealing**: two (or N)
colluding accounts repeatedly create and accept each other's bets to inflate
volume and "completed bets" at near-zero cost. Every design choice below is
shaped by resistance to that attack.

---

## 1. Available signals (what we actually have today)

| Source table | Signal | Notes |
| --- | --- | --- |
| `auth.users` | `created_at` (account age), `status` (active/suspended/banned) | age + hard T&S state |
| `app.bets` | `creator_user_id`, `acceptor_user_id`, `status`, `resolved_winner_user_id`, lifecycle timestamps, `stake_per_side_usdc` | who, with whom, outcome, when |
| `app.bet_participants` | per-user `role`, `side`, `stake_locked_usdc` | participation + stake |
| `app.settlements` | `winner_user_id`, `loser_user_id`, `kind` (`winner_payout`/`draw_refund`), `pot_usdc`, `net_winner_usdc`, `settled_at` | **authoritative completion + outcome** |
| `app.disputes` | `opener_user_id`, `claimed_winner_user_id`, `status` (`open`/`upheld`/`rejected`/`withdrawn`), `deposit_usdc`, `ruled_at` | **admin-adjudicated** behavioral signal |
| `app.payouts` | success / failure | reliability of payout (mostly platform-side) |
| `app.bet_events` | full lifecycle feed | derivable history |
| `financial.deposits` | real on-chain USDC deposited | hard sybil-cost signal (see §3) |

Derived (already built in `core/profiles`): wins, losses, volume, counts.

---

## 2. Fraud-resistant signals (trustworthy inputs)

These are expensive or impossible to fake at scale:

1. **Admin-ruled dispute outcomes** (`disputes.status` ∈ {upheld, rejected}).
   Decided by humans, not by the user → cannot be self-manufactured. Strongest
   behavioral signal.
2. **Distinct counterparties** — the number of *different* users you have
   matched, settled bets with. A wash-trading ring has few distinct
   counterparties no matter how many bets it churns.
3. **Account age** (`created_at`) — time cannot be back-dated. (Weak on its own:
   sybil farms can pre-age accounts cheaply — so it is low-weight and
   activity-gated.)
4. **Net real deposits** (`financial.deposits`) — wash loops recycle *internal*
   balance; they do not create new on-chain deposits. Net deposited capital is a
   genuine sybil cost. (Proposed as an optional enhancement input, see §3/§11.)

## 3. Easily-manipulated signals (use with care or exclude)

| Signal | Attack | Mitigation in this design |
| --- | --- | --- |
| Raw bet count | wash trading | never used raw; replaced by **distinct counterparties** + diminishing returns |
| Gross volume | wash trading recycles same capital | **per-counterparty cap** + log scaling + low weight |
| Win rate | self-dealing (alt deliberately loses) | **capped at 5% weight**, Laplace-smoothed; extreme rates flagged internally (§4.1) — never a driver |
| Share clicks/conversions | trivially botted | **excluded** |
| Completed-bet count | wash trading | log/diminishing + gated by distinct counterparties |
| Account age | sybil pre-aging | low weight + multiplied by an activity gate |

**Economic friction:** every matched bet costs the creator a creation fee (0.50)
and the winner a settlement fee (2.5%). This makes wash loops non-free but not
prohibitively expensive — friction alone is insufficient, hence the structural
mitigations above.

---

## 4. Scoring model

A single integer **0–100**, composed of a positive activity composite scaled by
a multiplicative integrity factor and a hard status modifier.

### 4.1 Component sub-scores (each normalised to [0,1])

Let `ln1p(x) = log(1 + x)` and `norm(x, target) = clamp(ln1p(x)/ln1p(target), 0, 1)`.

| Sub-score | Definition | Target | Weight |
| --- | --- | --- | --- |
| `exp` (experience) | `norm(distinctCounterparties, 25)` | 25 distinct CPs ≈ full | **0.40** |
| `comp` (completion) | `norm(completedBets, 50)` | 50 settled bets ≈ full | 0.20 |
| `vol` (volume) | `norm(cappedSettledVolume, 2000)` | 2000 USDC ≈ full | 0.20 |
| `age` | `norm(ageDays, 365) × activityGate` | 1 year ≈ full | 0.15 |
| `win` (track record) | `(wins + 1) / (wins + losses + 2)` (Laplace, neutral 0.5) | — | **0.05** |

- `distinctCounterparties` = count of distinct other users across the user's
  **matched** bets (acceptor present).
- `completedBets` = matched bets in status `SETTLED` or `PAID` (wins **and**
  losses **and** draws all count — completing a *lost* bet honestly is good
  behaviour).
- `cappedSettledVolume` = Σ over completed bets of `min(userStake, 100)` **per
  counterparty** (i.e. only the first 100 USDC of settled stake with any single
  counterparty counts). Kills whale-loop inflation.
- `ageDays` = days since `created_at`.
- `activityGate` = `min(1, completedBets / 3)` — a dormant aged account earns
  almost no age credit.
- `win` = `(wins + 1) / (wins + losses + 2)` — settled win/loss only (draws
  excluded). Laplace smoothing keeps new/low-sample users at the 0.5 neutral
  baseline. Capped at a 5% weight so it can never drive the score; the
  multiplicative integrity gate (§4.2) is what actually catches manipulation.
- **Extreme-rate anomaly flag (internal only):** when `wins + losses ≥ 20` and
  the raw win-rate is `≥ 0.95` or `≤ 0.05`, set `components.winRateAnomaly =
  true`. This does **not** change the public score — it surfaces possible
  self-dealing/dumping to Trust & Safety, honouring "extreme results are a
  signal" without letting it move the number.

Positive composite: `P = 0.40·exp + 0.20·comp + 0.20·vol + 0.15·age + 0.05·win` ∈ [0,1].

### 4.2 Integrity factor (multiplicative penalty)

```
matched          = # matched bets (denominator)
frivolousRate    = frivolousDisputes / (matched + 5)
adverseRate      = adverseDisputes   / (matched + 5)
I = clamp(1 − (2.0·frivolousRate + 3.0·adverseRate), 0.10, 1.0)
```

- `frivolousDisputes` = disputes the user **opened** that were **rejected**.
- `adverseDisputes` = disputes **upheld against** the user (user is a participant
  and `user ≠ claimed_winner` of an upheld dispute → an admin reversed a result
  in the user's favour, i.e. the user benefited from a wrong outcome).
- `withdrawn` disputes → **no penalty** (user self-corrected).
- Disputes the user opened **and won** (upheld in their favour) → **neutral**
  (not rewarded, to avoid incentivising dispute spam).
- The `+5` is Laplace smoothing so one dispute in two bets does not nuke a new
  user; small samples are pulled toward neutral.

Integrity is **multiplicative** so a cheater with many adverse rulings is heavily
discounted regardless of how much volume they churned.

### 4.3 Status modifier + final score

```
raw = 100 · P · I
active     → score = round(raw)
suspended  → score = min(round(raw), 30)
banned     → score = 0
```

### 4.4 Provisional ("New") state

Until the account clears all of: `matched ≥ 3` AND `distinctCounterparties ≥ 3`
AND `ageDays ≥ 7` AND `completedBets ≥ 3`, the profile shows **"New"** rather
than a number. This prevents both unfair low scores for legitimate newcomers and
low-data gaming.

### 4.5 Tiers (for badges / sorting)

| Score | Tier |
| --- | --- |
| provisional | New |
| 0–19 | Untrusted |
| 20–39 | Bronze |
| 40–59 | Silver |
| 60–79 | Gold |
| 80–100 | Trusted |

---

## 5. How dispute ratio counts (answer to Q5)

Only **admin-ruled** disputes count — never `open` ones. Two negative classes,
weighted differently because they signal different things:

- **Frivolous** (you opened it, it was rejected) → weight 2.0. Signals
  bad-faith friction / griefing.
- **Adverse** (upheld against you) → weight 3.0. Stronger: an admin found the
  result you stood to benefit from was wrong.

Both are expressed as **rates over matched bets** with Laplace smoothing, fed
into the multiplicative integrity factor (§4.2). Withdrawn = forgiven; winning a
dispute you opened = neutral. Rationale: dispute *integrity* is the most
fraud-resistant behavioral signal we have, so it gates the whole score rather
than being a small additive term.

## 6. How volume counts (answer to Q6)

- **Settled** volume only (bets that reached `SETTLED`/`PAID`) — not open or
  merely-matched stake.
- **Per-counterparty capped** at 100 USDC of settled stake → repeated trading
  with the same alt yields diminishing then zero credit.
- **Log-scaled** to a 2000 USDC target and held to a **low 20% weight**, because
  even capped volume is more manipulable than distinct counterparties.
- Future hardening: blend in **net on-chain deposits** (real sybil cost) — §11.

## 7. How account age counts (answer to Q7)

- `ageDays` since `created_at`, **log-scaled** to a 1-year target.
- **Activity-gated**: multiplied by `min(1, completedBets/3)` so a freshly-aged
  but inactive sybil account gains almost nothing.
- **Low 20% weight** and never the dominant term, because pre-aging accounts is
  cheap for a determined farm.

## 8. How completed bets count (answer to Q8)

- "Completed" = matched bets in `SETTLED`/`PAID` (wins, losses, draws alike).
- Feeds **two** places: the `comp` sub-score (log/diminishing, so raw count can't
  be farmed linearly) and, indirectly, `distinctCounterparties` (the anti-sybil
  core). Raw completed-count is **never** used at full linear weight.
- Voided / cancelled / expired-unmatched bets are **excluded** (neither credit
  nor penalty) — they are not honest completions but also not misconduct.

---

## 9. Storage & computation

- **Materialised snapshot**, not computed per page view (the inputs are several
  aggregations across bets/settlements/disputes — too heavy for hot paths).
- New table `app.user_reputation`:
  `user_id` (PK), `score` (int), `tier`, `provisional` (bool),
  `components` (jsonb: the raw signals + sub-scores for transparency/debugging),
  `computed_at`.
- **Recompute triggers** (event-driven first, cron as safety net):
  1. **Settlement** → recompute both participants immediately (in/after the
     settlement transaction).
  2. **Dispute ruling** (upheld/rejected) → recompute the affected users
     immediately.
  3. **Suspension / ban** (status change) → recompute that user immediately
     (status modifier in §4.3 must take effect at once).
  4. **Nightly cron fallback** → recompute any user with activity since the last
     run, and catch anything the direct triggers missed (e.g. age tier crossings
     over time). Idempotent: same inputs → same snapshot.
- Pure scoring function `computeReputation(signals): ReputationResult` is
  side-effect-free and fully unit-testable with synthetic signal sets — this is
  where fraud-resistance gets test coverage (e.g. "wash loop of 100 bets with 1
  counterparty scores far below 20 honest counterparties").

### Proposed module layout (for the build sprint, not now)

```
packages/core/src/reputation/
  types.ts        ReputationSignals, ReputationResult, tier enum, weights/config
  signals.ts      gatherReputationSignals(db, userId)  — the aggregations
  score.ts        computeReputation(signals)           — pure, tested
  recompute.ts    recomputeUserReputation(db, userId)  — gather → score → upsert
  query.ts        getReputation(db, userId)            — read snapshot
  index.ts
```

---

## 10. Integration points (why it's reusable)

- **Profiles**: show the **tier badge** (or "New") in the header. The numeric
  score is **not** shown publicly.
- **Marketplace**: show the creator's **tier badge only** on bet cards/detail.
  No score, no numbers. (Future: optional sort/filter by minimum tier.)
- **Future Leaderboards**: will rank on **score + volume** (the only consumer
  that reads the numeric score for ordering); reputation can also gate
  eligibility (e.g. only non-provisional accounts rank).
- **Future Trust & Safety**: thresholds drive limits (e.g. provisional/low-score
  accounts get tighter `MAX_BET`/`MAX_TVL`), and the `components` jsonb (incl.
  `winRateAnomaly`) gives reviewers the raw evidence behind a score.

### Visibility matrix

| Field | Public | Internal (T&S / leaderboard / debug) |
| --- | --- | --- |
| Tier badge | ✅ shown | ✅ |
| Numeric score (0–100) | ❌ hidden | ✅ stored & used |
| `components` breakdown | ❌ hidden | ✅ stored |
| Weight constants | ❌ | ✅ (config) |

Rationale: showing only the tier avoids handing attackers an exact gaming recipe
while still letting honest users and the marketplace gauge trust at a glance.

---

## 11. Edge cases & future hardening

- **No matched bets** → provisional "New"; positive composite is tiny (age only,
  activity-gated to ~0). No division-by-zero (smoothing denominators are `+k`).
- **Draws** (`draw_refund`) count as clean completions.
- **Self-dealing detection**: covered structurally by distinct-counterparty
  weighting + per-counterparty volume cap; a future explicit signal could flag
  rings (shared funding wallet, reciprocal-only trading).
- **Decay** (optional later): weight recent behaviour over ancient history.
- **Net deposits component** (optional later): real on-chain capital as an
  additional fraud-resistant volume proxy.
- Signals not available today (would strengthen sybil resistance): device/IP
  fingerprint, KYC tier. Out of scope for Fase 1.

---

## 12. Decisions

**Locked (review round 1):**

1. **Weights** — `exp 0.40 / comp 0.20 / vol 0.20 / age 0.15 / win 0.05`;
   integrity penalties frivolous 2.0, adverse 3.0. ✅
2. **Win-rate** — included at 5% max, Laplace-smoothed; extreme rates set an
   internal `winRateAnomaly` flag only (no score impact). ✅
3. **Recompute** — event-driven (settlement, dispute ruling, suspension/ban) +
   nightly cron fallback. ✅
4. **Visibility** — public: tier badge only; internal: score 0–100 + components
   stored. Marketplace uses tier badges only. ✅
5. **Leaderboards** — will consume score + volume (later sprint). ✅
6. **Tiers** — New / Untrusted / Bronze / Silver / Gold / Trusted (bands §4.5). ✅
7. **Provisional thresholds** — `matched≥3, distinctCP≥3, age≥7d, completed≥3`. ✅

8. **Net deposits** — **NOT** used in reputation v1. May be used later by Trust
   & Safety. v1 inputs are exactly: distinct counterparties, completed bets,
   settled volume, account age, dispute integrity, win-rate (≤5%). ✅

_All decisions locked. Build plan: `docs/reputation-build-plan.md`._
