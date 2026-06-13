/**
 * Centralised denylist of phrasings that mark a bet as subjective and
 * therefore unsupported. Every objective bet — template-based or
 * open-objective — passes its `title` and `description` through `containsSubjectivePhrase`.
 *
 * The phrasings are kept narrow to avoid blocking legitimate objective wording
 * (e.g. "Best XI" team names) while catching the canonical traps from the
 * blueprint:
 *   "Wie is beter?"
 *   "Wie is mooier?"
 *   "Wie heeft meer talent?"
 *   "Wie is populairder?"
 *   "Who is better?"
 *   "Who is prettier?"
 *
 * Detection is regex-based, case-insensitive, Unicode-aware.
 */

const SUBJECTIVE_PATTERNS: ReadonlyArray<RegExp> = [
  // Dutch "wie is X-er/-tje" style
  /\bwie\s+is\s+(beter|beste|mooier|mooiste|leuker|liever|populairder|populairst|gevaarlijker|sterker|knapper)\b/iu,
  /\bwie\s+heeft\s+(meer|de\s+meeste)\s+(talent|charisma|aanhang|invloed|smaak|stijl)\b/iu,
  /\bwie\s+is\s+de\s+(beste|mooiste|leukste|populairste|grappigste|stoerste)\b/iu,

  // English "who is X-er"
  /\bwho\s+is\s+(better|best|prettier|prettiest|cuter|hotter|sexier|funnier|smarter|wiser|nicer|cooler|stronger|tougher)\b/iu,
  /\bwho\s+has\s+(more|the\s+most)\s+(talent|charisma|swag|style|skill|drip)\b/iu,
  /\bwho\s+is\s+the\s+(best|prettiest|hottest|coolest|funniest)\b/iu,

  // Subjective comparisons by adjective
  /\b(beter|mooier|leuker|knapper|populairder|sterker|slimmer|grappiger|stoerder)\s+dan\b/iu,
  /\b(better|prettier|cooler|funnier|smarter|nicer|stronger|tougher)\s+than\b/iu,
];

export interface SubjectivePhraseHit {
  matched: string;
  pattern: string;
}

/** Returns the first matching pattern, or `null` when text is objectively phrased. */
export function findSubjectivePhrase(text: string): SubjectivePhraseHit | null {
  for (const pattern of SUBJECTIVE_PATTERNS) {
    const m = pattern.exec(text);
    if (m) {
      return { matched: m[0], pattern: pattern.source };
    }
  }
  return null;
}

export function containsSubjectivePhrase(text: string): boolean {
  return findSubjectivePhrase(text) !== null;
}
