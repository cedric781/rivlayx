import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { OPS_DEFAULTS } from './config';

// G2 — runbook link integrity: every anchor referenced by OPS_DEFAULTS.runbooks
// must resolve to a heading in docs/runbooks.md. Fails if an alert type gets a
// runbook link without a matching section (or a heading is renamed away).

const here = dirname(fileURLToPath(import.meta.url));
const RUNBOOKS = resolve(here, '..', '..', '..', '..', 'docs', 'runbooks.md');

/** GitHub-flavoured heading slug: lowercase, drop punctuation, spaces → hyphens. */
function slugify(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .replace(/\s+/g, '-');
}

function headingSlugs(markdown: string): Set<string> {
  const slugs = new Set<string>();
  for (const line of markdown.split('\n')) {
    const m = /^#{1,6}\s+(.*)$/.exec(line);
    if (m) slugs.add(slugify(m[1]!));
  }
  return slugs;
}

function anchorOf(url: string): string {
  const i = url.indexOf('#');
  return i === -1 ? '' : url.slice(i + 1);
}

describe('runbook link integrity', () => {
  const markdown = readFileSync(RUNBOOKS, 'utf-8');
  const slugs = headingSlugs(markdown);

  const entries = Object.entries(OPS_DEFAULTS.runbooks);

  it('every alert type has a runbook URL with an anchor', () => {
    for (const [type, url] of entries) {
      expect(url, `runbook for ${type}`).toMatch(/#.+$/);
    }
  });

  it.each(entries)('runbook anchor for %s resolves to a heading', (_type, url) => {
    const anchor = anchorOf(url);
    expect(slugs.has(anchor), `missing heading for anchor "#${anchor}"`).toBe(true);
  });
});
