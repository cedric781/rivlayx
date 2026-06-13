import { describe, expect, it } from 'vitest';
import { containsSubjectivePhrase, findSubjectivePhrase } from './subjective-terms';

describe('findSubjectivePhrase — blueprint canonical cases', () => {
  const banned = [
    'Wie is beter?',
    'wie is mooier',
    'Wie heeft meer talent',
    'Wie is populairder',
    'Who is better at this',
    'who is prettier',
    'who is the best',
    'beter dan Messi',
    'cooler than the rest',
  ];

  for (const text of banned) {
    it(`rejects "${text}"`, () => {
      const hit = findSubjectivePhrase(text);
      expect(hit, `expected match but got null for: ${text}`).not.toBeNull();
    });
  }
});

describe('findSubjectivePhrase — objective phrasings pass through', () => {
  const allowed = [
    'Ajax wins from PSV on 2026-06-15',
    'BTC price above 200000 by 2026-12-31',
    'Persoon A loopt 10km voor zondag 18:00',
    'Manchester City beats Liverpool',
    'Tennis match between A and B — first set winner',
    'ETH price below 4000 on 2026-09-01',
    'Marathon completed by participant 23',
  ];

  for (const text of allowed) {
    it(`accepts "${text}"`, () => {
      expect(containsSubjectivePhrase(text)).toBe(false);
    });
  }
});

describe('findSubjectivePhrase — case + punctuation insensitive', () => {
  it('matches regardless of casing', () => {
    expect(containsSubjectivePhrase('WHO IS BETTER')).toBe(true);
    expect(containsSubjectivePhrase('WiE iS MOOIER')).toBe(true);
  });

  it('matches when wrapped in punctuation', () => {
    expect(containsSubjectivePhrase('Who is better!?')).toBe(true);
    expect(containsSubjectivePhrase('  Wie is beter?  ')).toBe(true);
  });
});
