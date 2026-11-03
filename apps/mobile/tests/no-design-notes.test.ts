import { describe, expect, it } from 'vitest';
import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The design system's stylesheet comes from the mockups, whose notes track the design rounds ("revision 12", "round D1
// batch 2c", "proposed, not in the code") and dated rules ("user's rule 2026-10-24"). In the app's code and its tests
// these say nothing to a reader (the rounds live outside the repository) and some are false; comments describe the rule
// instead. Work-item numbers ("WP2.3") and plan phases ("Phase 1") are left out for the same reason.
const root = join(__dirname, '..');
const files = [
  ...globSync('src/**/*.{css,vue,ts}', { cwd: root }),
  ...globSync('tests/**/*.ts', { cwd: root }),
]
  .map((f) => f.replace(/\\/g, '/'))
  .filter((f) => f !== 'tests/no-design-notes.test.ts');
const NOTES =
  /\b[Rr]evisions? \d+|\bround D\d|\bbatch \d[a-z]?\b|not in the code|user's rule|\(\d{4}-\d{2}-\d{2}\)|\bWP\d|\b[Pp]hase \d/;

function notes(text: string): string[] {
  return text
    .split(/\r?\n/)
    .flatMap((line, i) => (NOTES.test(line) ? [`${i + 1}: ${line.trim()}`] : []));
}

describe('the phone app sources and tests', () => {
  it('found the design system stylesheet and the tests among the files to check', () => {
    expect(files).toContain('src/theme/design-system/bundle.css');
    expect(files).toContain('tests/components.test.ts');
  });

  it('flags a design-round note', () => {
    expect(
      notes('/* ok */\n/* Revision 17. A page */\n/* ── Mobile layer, round D1 batch 1 */'),
    ).toHaveLength(2);
  });

  it('flags a work-item number and a plan phase', () => {
    expect(
      notes('// The plan service (WP2.3f)\n// not selectable in Phase 1\n// a phase of the moon'),
    ).toHaveLength(2);
  });

  it.each(files)('%s carries no design-round notes', (file) => {
    expect(notes(readFileSync(join(root, file), 'utf8'))).toEqual([]);
  });
});
