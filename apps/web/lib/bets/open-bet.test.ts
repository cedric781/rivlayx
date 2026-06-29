import { describe, expect, it } from 'vitest';
import { buildOpenBetInput, createBetErrorMessage, slugifyTitle } from './open-bet';

describe('slugifyTitle', () => {
  it('lowercases and hyphenates a normal title', () => {
    expect(slugifyTitle('Will it rain in Amsterdam')).toBe('will-it-rain-in-amsterdam');
  });

  it('collapses punctuation and trims edge hyphens', () => {
    expect(slugifyTitle('  BTC > $100k?! ')).toBe('btc-100k');
  });

  it('falls back to "open-bet" when nothing usable remains', () => {
    expect(slugifyTitle('—  ?! ')).toBe('open-bet');
    expect(slugifyTitle('')).toBe('open-bet');
  });

  it('caps the slug length and leaves no trailing hyphen', () => {
    const slug = slugifyTitle('a'.repeat(200));
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('buildOpenBetInput', () => {
  const fields = {
    title: 'Will the marathon finish before noon',
    stakeUsdc: '5',
    creatorSide: 'yes',
    expiresAt: '2026-06-16T10:00:00.000Z',
    resolvesBy: '2026-06-20T12:00:00.000Z',
  };

  it('produces an open_objective, platform-arbiter-resolved bet', () => {
    const input = buildOpenBetInput('user-1', fields);
    expect(input.betType).toBe('open_objective');
    expect(input.resolveType).toBe('arbiter');
    expect(input.arbiterType).toBe('platform_selected');
    expect(input.creatorUserId).toBe('user-1');
    expect(input.stakePerSideUsdc).toBe('5');
    expect(input.creatorSide).toBe('yes');
    expect(input.expiresAt).toBe(fields.expiresAt);
  });

  it('builds an honest event_occurs_before predicate whose deadline is resolvesBy', () => {
    const input = buildOpenBetInput('user-1', fields);
    expect(input.predicate).toEqual({
      type: 'event_occurs_before',
      eventReference: 'manual:will-the-marathon-finish-before-noon',
      deadlineAt: '2026-06-20T12:00:00.000Z',
    });
  });

  it('passes no templateId and no pre-bound arbiter (platform selects later)', () => {
    const input = buildOpenBetInput('user-1', fields);
    expect(input.templateId).toBeUndefined();
    expect(input.arbiterUserId).toBeUndefined();
  });
});

describe('createBetErrorMessage', () => {
  it('maps the four required engine codes to user-facing copy', () => {
    expect(createBetErrorMessage('SUBJECTIVE_LANGUAGE')).toMatch(/subjective/i);
    expect(createBetErrorMessage('STAKE_TOO_LARGE')).toMatch(/cap/i);
    expect(createBetErrorMessage('INSUFFICIENT_BALANCE')).toMatch(/deposit more/i);
    expect(createBetErrorMessage('FROZEN')).toMatch(/paused|freeze/i);
  });

  it('uses the provided fallback for unknown codes', () => {
    expect(createBetErrorMessage('SOMETHING_ELSE', 'boom')).toBe('boom');
  });

  it('has a generic default when no fallback is given', () => {
    expect(createBetErrorMessage('SOMETHING_ELSE')).toMatch(/could not create/i);
  });
});
