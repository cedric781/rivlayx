import { z } from 'zod';

/**
 * Supported objective predicate kinds. Each one is a discriminated Zod schema
 * with all fields required — there is no "free text resolve criteria" escape.
 * When the resolve engine runs (Sprint 7+) it reads `predicate.type` and
 * dispatches to the matching handler. Sprint 6 only validates + persists.
 */

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

const isoDateTime = z.string().regex(ISO_DATE_TIME, 'must be ISO-8601 datetime');

/** Stable external reference, e.g. `apifootball:fixture:1234567` or `coingecko:bitcoin`. */
const externalReference = z
  .string()
  .min(3)
  .max(128)
  .regex(/^[a-z0-9_-]+:[a-z0-9_:.-]+$/i, 'must be "<provider>:<ref>"');

export const teamWinsSchema = z.object({
  type: z.literal('team_wins'),
  team: z.string().min(1).max(64),
  eventReference: externalReference,
});
export type TeamWinsPredicate = z.infer<typeof teamWinsSchema>;

export const scoreOverUnderSchema = z.object({
  type: z.literal('score_over_under'),
  eventReference: externalReference,
  threshold: z.number().nonnegative(),
  side: z.enum(['over', 'under']),
});
export type ScoreOverUnderPredicate = z.infer<typeof scoreOverUnderSchema>;

export const priceAboveSchema = z.object({
  type: z.literal('price_above'),
  asset: externalReference,
  threshold: z.number().positive(),
  deadlineAt: isoDateTime,
});
export type PriceAbovePredicate = z.infer<typeof priceAboveSchema>;

export const priceBelowSchema = z.object({
  type: z.literal('price_below'),
  asset: externalReference,
  threshold: z.number().positive(),
  deadlineAt: isoDateTime,
});
export type PriceBelowPredicate = z.infer<typeof priceBelowSchema>;

export const eventOccursBeforeSchema = z.object({
  type: z.literal('event_occurs_before'),
  eventReference: externalReference,
  deadlineAt: isoDateTime,
});
export type EventOccursBeforePredicate = z.infer<typeof eventOccursBeforeSchema>;

export const distanceCompletedSchema = z.object({
  type: z.literal('distance_completed'),
  distanceKm: z.number().positive(),
  deadlineAt: isoDateTime,
  /** Person/entity who must complete the distance — for evidence-resolve. */
  subject: z.string().min(1).max(80),
});
export type DistanceCompletedPredicate = z.infer<typeof distanceCompletedSchema>;

export const predicateSchema = z.discriminatedUnion('type', [
  teamWinsSchema,
  scoreOverUnderSchema,
  priceAboveSchema,
  priceBelowSchema,
  eventOccursBeforeSchema,
  distanceCompletedSchema,
]);
export type BetPredicate = z.infer<typeof predicateSchema>;

export const predicateKindValues = [
  'team_wins',
  'score_over_under',
  'price_above',
  'price_below',
  'event_occurs_before',
  'distance_completed',
] as const;
export type PredicateKind = (typeof predicateKindValues)[number];

/** Render a predicate as a canonical human-readable string for `bet_rules.display`. */
export function renderPredicate(p: BetPredicate): string {
  switch (p.type) {
    case 'team_wins':
      return `${p.team} wins (event ${p.eventReference})`;
    case 'score_over_under':
      return `Total score ${p.side} ${p.threshold} (event ${p.eventReference})`;
    case 'price_above':
      return `${p.asset} price above ${p.threshold} by ${p.deadlineAt}`;
    case 'price_below':
      return `${p.asset} price below ${p.threshold} by ${p.deadlineAt}`;
    case 'event_occurs_before':
      return `${p.eventReference} occurs before ${p.deadlineAt}`;
    case 'distance_completed':
      return `${p.subject} completes ${p.distanceKm} km by ${p.deadlineAt}`;
  }
}
