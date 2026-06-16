import type { bets } from '@rivlayx/core';

/**
 * Closed-alpha "open bet" mapping (Sprint 26). The bet engine has no free-text
 * bet type — every bet carries a typed objective predicate. An alpha open bet
 * is therefore modelled as an **arbiter-resolved** bet whose predicate is an
 * honest `event_occurs_before`:
 *   - `eventReference` = `manual:<title-slug>` (the bet is judged manually)
 *   - `deadlineAt`     = the user-chosen **resolvesBy** date
 *
 * The deadline is a real, user-facing field ("judged after this date") — there
 * is no hidden/synthetic predicate. This module is a pure form→engine adapter:
 * it adds no business logic of its own; `createBet` enforces every rule.
 */

/** The five fields the create-bet form collects. */
export interface OpenBetFormFields {
  title: string;
  stakeUsdc: string;
  creatorSide: string;
  /** ISO datetime — when the OPEN window closes if nobody accepts. */
  expiresAt: string;
  /** ISO datetime — when a platform arbiter judges the outcome. */
  resolvesBy: string;
}

const EVENT_REF_PREFIX = 'manual';
/** Keep `manual:` + slug well under the predicate's 128-char eventReference cap. */
const MAX_SLUG_LEN = 80;

/**
 * Turn a title into the slug used inside `manual:<slug>`. Lowercase, ASCII
 * alphanumerics only, runs of anything else collapse to a single hyphen. Falls
 * back to `open-bet` when the title has no usable characters, so the reference
 * always satisfies the engine's `<provider>:<ref>` format.
 */
export function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LEN)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : 'open-bet';
}

/**
 * Map the form fields to a `createBet` input. Pure — no DB, no clock. The
 * predicate's `deadlineAt` is the user's `resolvesBy`, so what the engine stores
 * matches what the user was shown.
 */
export function buildOpenBetInput(
  creatorUserId: string,
  fields: OpenBetFormFields,
): bets.CreateBetInput {
  return {
    creatorUserId,
    betType: 'open_objective',
    title: fields.title,
    predicate: {
      type: 'event_occurs_before',
      eventReference: `${EVENT_REF_PREFIX}:${slugifyTitle(fields.title)}`,
      deadlineAt: fields.resolvesBy,
    },
    resolveType: 'arbiter',
    resolveSource: {},
    arbiterType: 'platform_selected',
    stakePerSideUsdc: fields.stakeUsdc,
    creatorSide: fields.creatorSide,
    expiresAt: fields.expiresAt,
  };
}

/**
 * User-facing messages for the bet-engine error codes the create flow can hit.
 * Covers the four required cases; anything else falls back to the engine
 * message (or a generic line). Pure + shared by the route and the form.
 */
export function createBetErrorMessage(code: string, fallback?: string): string {
  switch (code) {
    case 'SUBJECTIVE_LANGUAGE':
      return 'That phrasing reads as subjective. Use an objectively measurable statement (no "best", "nicest", etc.).';
    case 'STAKE_TOO_LARGE':
      return 'Stake exceeds the per-bet cap. Lower the amount and try again.';
    case 'INSUFFICIENT_BALANCE':
      return 'Insufficient balance — deposit more USDC to cover your stake plus the creation fee.';
    case 'FROZEN':
      return 'New bets are temporarily paused (platform freeze). Please try again later.';
    default:
      return fallback ?? 'Could not create the bet. Please check your inputs and try again.';
  }
}
