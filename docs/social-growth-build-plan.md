# Sprint 19 — Social & Growth (Build Plan)

> **Design artifact only — no code, no migrations, no implementation this
> sprint.** Describes how the social/growth surface would be built on top of
> reputation (Sprint 15/16) and risk (Sprint 17). No financial reward, payout,
> fee or balance change is introduced (referrals/badges are non-financial).

## 1. Architecture (proposed)

A new core module `packages/core/src/social/`, mirroring the pure-core +
read-only-I/O split. It **reads** public-safe reputation projections and writes
only its own `social_*` / growth tables. It never selects the reputation/arbiter
`score`, risk data, or balances into any public response.

```
packages/core/src/social/
  types.ts        leaderboard/badge/feed/referral shapes (public-safe only)
  config.ts       periods, rate limits, badge rules, referral gates
  follows.ts      follow/unfollow/block, counts
  referrals.ts    code issue, attribution, qualification (risk-gated)
  badges.ts       PURE: public-safe event history → earned badges
  leaderboards.ts snapshot build (cron) + read
  feed.ts         activity event write + visibility-filtered read
  privacy.ts      read-time visibility evaluation
  query.ts        public-safe reads for the web app
  index.ts        exports
```

`badges.ts` is a **pure** function (event counts/tiers → badge set), unit-tested
without a DB. Reputation is consumed exclusively via the existing
`getReputation` / `getReputationMany` / `listTopArbiters` public-safe helpers.

## 2. Data model (proposed — additive only, future migration)

No existing table altered; no money/score column exposed.

- `app.user_follows` — `(follower_id, followee_id)` PK, `created_at`; FK→users
  cascade. Plus `app.user_blocks`.
- `app.referral_codes` — `user_id`, `code` (unique).
- `app.referrals` — `referrer_id`, `referred_id` (unique), `code`, `status`
  (pending/qualified/rejected), `qualified_at`, risk-decision snapshot.
- `app.achievements` (catalog) + `app.user_achievements` —
  `(user_id, achievement_key)` PK, `earned_at`, `revoked_at`.
- `app.activity_events` — `id`, `actor_id`, `type`, `subject_ref`, `visibility`,
  `created_at` (append-only feed source; no amounts/scores).
- `app.leaderboard_snapshots` — `period`, `board`, `rank`, `user_id`, `value`
  (precomputed, public-safe metrics only).
- `app.user_social_prefs` — `user_id` PK: `leaderboard_opt_out`,
  `private_profile`, `feed_opt_out`, etc. Defaults conservative.

All FK→`auth.users` cascade so deletion removes the social footprint.

## 3. Read-time privacy (no leaks)

A single `privacy.ts` resolver decides, per viewer, what is visible — evaluated
at read time so toggling private immediately hides past activity. Every public
query routes through it; a lint/test guard asserts no public query selects
`user_reputation.score` / `arbiter_score` / risk / balance columns.

## 4. APIs / pages (proposed)

Web (public, public-safe): `/leaderboards`, enhanced `/profile/[username]`,
`/arbiters` (extend existing), follow/unfollow actions, referral landing,
personalized + global feeds. Admin: moderation view for growth-abuse (read-only,
ties into enforcement proposals — never auto money action).

## 5. Cron (proposed)

- `/api/cron/leaderboards` (e.g. hourly/daily) — rebuild snapshots applying
  opt-out + risk + provisional filters at build time.
- `/api/cron/badges` (e.g. daily) — recompute earned/revoked badges.
Both advisory-locked like existing crons; read-only except their own tables.

## 6. Anti-spam + risk integration

- Rate limits in `config.ts` (follows/referrals/feed actions per window).
- Referral **qualification** consumes Sprint 17 signals (shared-funding / sybil
  cluster link between referrer and referred → reject); logged for audit.
- Leaderboard/badge inclusion excludes provisional, opted-out, suspended/banned,
  and risk-flagged-at-band accounts.
- Growth abuse emits a risk signal; heavier responses go through the Sprint 18
  enforcement layer (reversible, human-gated) — never an auto money action.

## 7. Test plan (for the future implementation sprint)

- **Pure badge tests**: event counts/tiers → correct badges; flagged user earns
  none; never keyed off a raw score.
- **Privacy guard**: no public query returns score/arbiter-score/risk/balance;
  private profile hides history from non-followers; opt-out removes from boards.
- **Referral anti-fraud**: self-referral rejected; shared-funding/sybil link →
  not qualified; one attribution per referred account.
- **Anti-spam**: rate limits enforced; no self/duplicate follows.
- **Leaderboard correctness**: ranks by public-safe metric, excludes provisional/
  flagged/opted-out; snapshot determinism.
- **Isolation guard**: social recompute mutates no money/reputation/risk source
  rows (only `social_*` tables).

## 8. Rollout (proposed)

1. Profiles + public reputation display + top arbiters (lowest risk, reuses
   existing public-safe data).
2. Follows + feeds (privacy-gated).
3. Leaderboards + creator rankings (snapshot crons).
4. Achievement badges.
5. Referrals last — highest abuse surface — behind risk gating + monitoring,
   non-financial rewards only.

## 9. Out of scope (this sprint)

- All implementation, migrations and code.
- Any financial reward / payout / fee / balance change.
- Free-text UGC / messaging.
- Any exposure of reputation score, arbiter score, or risk data.
