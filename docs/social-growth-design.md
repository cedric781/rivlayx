# Sprint 19 — Social & Growth (Design)

> **Design only. No code, no migrations, no implementation.** Designs the social
> and growth surface — leaderboards, profiles, public reputation, referrals,
> badges, follows and feeds — on top of the existing reputation system (Sprint
> 15/16) and gated by the risk engine (Sprint 17). Nothing here is built this
> sprint.

## 0. Guiding principles

1. **Public-safe by construction.** The numeric reputation `score`, the arbiter
   `score`, all risk scores/bands/alerts, and financial balances are **never**
   exposed. The public surface is limited to already-public-safe projections:
   `PublicReputation = { tier, provisional }`, arbiter tier, counts, and account
   age. (This carries the Sprint 15/17 visibility rules forward unchanged.)
2. **Opt-in / opt-out everywhere.** Appearing on leaderboards, in feeds, or in
   "top" lists is user-controllable. Privacy defaults conservative.
3. **Growth must not create fraud.** Referrals, badges and rankings are designed
   to be **non-farmable**: rewards are non-financial or capped, attribution is
   sybil-resistant, and the risk engine gates participation. Growth never opens a
   new money surface or a wash-trade incentive.
4. **Reputation is the trust currency, not money.** Social ranking is built on
   tier + public activity counts, never on wagered USDC amounts or raw scores.
5. **Risk-aware.** Suspended/banned/flagged accounts are excluded from public
   surfaces (already the pattern in `listTopArbiters` via `VISIBLE_STATUSES`).

## 1. Leaderboards

Periodic (daily/weekly/all-time) rankings over **public-safe, opt-in** metrics:
- **Arbiters** — by arbiter tier + rulings + acceptance/overturned rate (builds
  directly on the existing `listTopArbiters`, which already excludes the score).
- **Creators** — by settled-bet count and tier (see §5).
- **Bettors** — by settled-bet count / win count, tier badge.

Rules:
- **Never volume-based.** Leaderboards may NEVER rank by wagered/settled USDC
  volume or by the raw reputation score (privacy + anti-whale + anti-farming).
  **Preferred ranking dimensions only:** trusted creators, top arbiters,
  completed-bet counts, clean streaks (consecutive dispute-free settlements),
  and reputation tiers. Show the tier badge, never the numbers behind it.
- Precomputed snapshots (cron), not live aggregation, to bound cost and to apply
  the opt-out/risk filter at snapshot time.
- Excludes provisional ("New") accounts from "top" boards (insufficient history)
  and anyone opted out, suspended, banned, or risk-flagged at/above a configured
  band.

## 2. User profiles

Extends the Sprint 14 profile. Public profile shows: username, display name,
account age, tier badge (+ "New" when provisional), arbiter tier (if any),
public achievement badges, follower/following counts, and **public** bet history
only. Never: score, risk data, balances, private bets, email.

- **Private-profile mode** hides activity/feed/history from non-followers (or
  everyone), keeping only the handle + tier badge.
- Honors the existing `users.status` (banned/deleted profiles are not shown).

## 3. Public reputation display

The badge component (Sprint 15) is the canonical surface. Reaffirmed rules:
- Show **tier** (`untrusted`→`trusted`) or **"New"** when `provisional`.
- Never render the numeric `score` or `components`.
- Read via `getReputation` / `getReputationMany` (public-safe projection) — no
  new query may select the score column into a public response.
- Arbiter tier shown analogously where relevant (e.g. on arbiter cards).

## 4. Top arbiters

A public "Top arbiters" surface backed by the existing `listTopArbiters`
(already returns tier + rulings + acceptance/overturned rate, never the score)
and the `/arbiters` page (Sprint 16). Social layer adds: opt-out, follow button,
and badge display. Ordering stays internal-score-driven server-side but only
public-safe fields are emitted.

## 5. Creator rankings

Rank bet **creators** by public-safe signals: count of settled bets created,
distinct-counterparty breadth (already a fraud-resistant reputation signal),
and tier. Used to power a "Top creators" board and a creator-quality badge on
marketplace cards. Reuses the marketplace ranking infra (Sprint 16 trending
boost) for surfacing, never exposing the underlying score.

## 6. Referral system

Invite-based growth with **sybil-resistant attribution** and **non-farmable
rewards**:
- Each user gets a referral **code**; a new signup may attribute one referrer.
- **Attribution gating** (anti-fraud): a referral only "qualifies" after the
  referred account reaches a genuine-activity threshold (e.g. N settled bets
  with distinct counterparties) AND passes a risk check (no shared-funding /
  sybil-cluster link to the referrer — consumes Sprint 17 signals). Self-referral
  and alt-account chains are rejected.
- **Rewards are PERMANENTLY non-financial.** This is a fixed, non-negotiable
  constraint of the platform, not a phase-1 limitation.
  **Forbidden, forever:** USDC rewards, fee discounts, payout bonuses,
  withdrawal bonuses, balance credits, or any monetary/economic perk.
  **Allowed only:** badges, cosmetics, profile flair, and social unlocks
  (non-economic features such as a custom profile theme or an early-access
  social surface). Reward fulfilment is out of scope; the design defines
  qualification + audit only. Because rewards are non-financial, referrals can
  never fund wash trading or create a payout-farming incentive.
- Referral relationships are logged for the risk engine (a referrer with many
  risk-flagged referrals is itself a signal).

## 7. Achievement badges

Milestone badges (first bet, 10/100 settled, reached a tier, top-arbiter,
long-tenure, etc.). Properties:
- **Earned from public-safe events only**, never from score thresholds that would
  leak the number.
- **Non-financial, cosmetic.** No badge grants money, limits or fee changes.
- **Risk/enforcement aware**: suspended/banned/flagged users do not earn or
  display badges; revocable if earned fraudulently.
- Deterministic + auditable rules in config, so badges can be recomputed.

## 8. Trust signals

Public trust indicators shown across profiles/cards/leaderboards:
- Reputation **tier** badge (+ "New").
- Arbiter **tier** (for adjudicators).
- **Account age** / tenure.
- Selected **achievement badges**.
- Aggregate **public counts** (settled bets, rulings).

Explicitly **not** trust signals on the public surface: numeric reputation/
arbiter scores, risk band/score, dispute internals, funding/balance data. Trust
signals must never become a backdoor to infer the hidden score (e.g. no
fine-grained "score range" badge).

## 9. Follow system

Users may follow other users:
- `follows(follower → followee)`; follower/following counts on profiles.
- **Block** and **private-account** semantics; a private account approves
  followers (or hides activity from non-followers).
- Follows drive the personalized feed (§10) and notifications (future).
- No financial meaning; following someone grants no betting privilege.

## 10. Activity feeds

Two feeds: a **global** public feed and a **personalized** (followed-users) feed.
- Events: created a **public** bet, won/settled a public bet, earned a badge,
  reached a tier, ruled as arbiter (public). **Private bets and private-profile
  users never appear.**
- Built from an append-only `activity_events` table with a `visibility` field
  evaluated against the actor's privacy settings at read time.
- **Never show exact stake amounts.** Feed items must not reveal precise USDC
  stakes (nor scores). Where a sense of scale is wanted, only a coarse,
  privacy-preserving bucket may be shown (e.g. "small / medium / large"), never
  a number. Only public-safe descriptions + tier badges otherwise.

## 11. Anti-spam rules

Growth surfaces are prime spam/farming targets, so:
- **Rate limits** on follows, referral-code use, and any feed-affecting action
  (per-account, per-window).
- **Sybil/risk gating**: referral qualification and leaderboard inclusion
  consume Sprint 17 risk signals; flagged clusters are excluded and their
  referrals do not qualify.
- **Dedup**: one referral attribution per referred account; no self-follow,
  no duplicate follows.
- **Provisional exclusion**: new/low-activity accounts cannot top boards or farm
  referral rewards until past the activity gate.
- **Feed throttling + content rules**: system-generated events only (no
  free-text user posts in this sprint), eliminating a whole spam class.
- **Enforcement hook (future)**: repeated growth-abuse becomes a risk signal and,
  via the Sprint 18 enforcement layer, can de-rank/hide an account (reversible,
  human-gated for anything heavier).

## 12. Privacy rules

- **Opt-out** of leaderboards, feeds and "top" lists; **private-profile** mode.
- **No exposure** of: numeric scores (reputation/arbiter), risk data, balances,
  email, private bets.
- **Visibility evaluated at read time** against the actor's current settings, so
  toggling private immediately hides past activity from new viewers.
- **Deletion/anonymization**: a deleted/banned user disappears from all public
  surfaces; social rows cascade on user delete (existing FK pattern).
- **Followers/blocks are private** to the user; counts may be public but lists
  respect privacy settings.
- **Minimal data**: feeds and leaderboards store derived, public-safe data only;
  no sensitive field is duplicated into a social table.

## 13. Out of scope (this sprint)

- All implementation, migrations and code.
- Any financial reward, payout, fee change or balance credit (referrals/badges
  are non-financial by design).
- Free-text user-generated content / messaging.
- Any exposure of reputation score, arbiter score, or risk data.
