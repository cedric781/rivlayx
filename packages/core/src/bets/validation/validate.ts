import { BetError } from '../errors';
import {
  predicateSchema,
  renderPredicate,
  type BetPredicate,
  type PredicateKind,
} from './predicate-types';
import { findSubjectivePhrase } from './subjective-terms';

export interface ObjectiveBetInput {
  title: string;
  description?: string | null;
  predicate: unknown;
  /**
   * When the bet comes from a template, the template's predicate kind. The
   * provided predicate's `type` must equal this — otherwise the template
   * binding is inconsistent.
   */
  expectedPredicateKind?: PredicateKind;
}

export interface ValidatedObjectiveBet {
  title: string;
  description: string | null;
  predicate: BetPredicate;
  display: string;
}

/**
 * Single entry point that all bet creation paths go through:
 *   - rejects subjective phrasing in title + description (NL + EN)
 *   - parses the predicate against the supported discriminated union
 *   - when bound to a template, enforces predicate kind match
 *   - renders the canonical display string used by `bet_rules.display`
 *
 * Throws `BetError` with a precise code on the first failure.
 */
export function validateObjectiveBet(input: ObjectiveBetInput): ValidatedObjectiveBet {
  const title = input.title.trim();
  const description = input.description?.trim() ?? null;

  if (title.length === 0 || title.length > 280) {
    throw new BetError('INVALID_INPUT', 'title must be 1..280 characters');
  }
  if (description && description.length > 2000) {
    throw new BetError('INVALID_INPUT', 'description must be <= 2000 characters');
  }

  const titleHit = findSubjectivePhrase(title);
  if (titleHit) {
    throw new BetError(
      'SUBJECTIVE_LANGUAGE',
      `Title rejected: "${titleHit.matched}" reads as subjective. Use an objectively measurable phrasing.`,
      { field: 'title', matched: titleHit.matched },
    );
  }
  if (description) {
    const descHit = findSubjectivePhrase(description);
    if (descHit) {
      throw new BetError(
        'SUBJECTIVE_LANGUAGE',
        `Description rejected: "${descHit.matched}" reads as subjective.`,
        { field: 'description', matched: descHit.matched },
      );
    }
  }

  const parsed = predicateSchema.safeParse(input.predicate);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('\n');
    throw new BetError(
      'UNKNOWN_PREDICATE',
      `Predicate is not a supported objective form:\n${issues}`,
    );
  }

  const predicate = parsed.data;
  if (input.expectedPredicateKind && predicate.type !== input.expectedPredicateKind) {
    throw new BetError(
      'TEMPLATE_PREDICATE_MISMATCH',
      `Template expects predicate.type='${input.expectedPredicateKind}', got '${predicate.type}'`,
    );
  }

  return {
    title,
    description,
    predicate,
    display: renderPredicate(predicate),
  };
}
