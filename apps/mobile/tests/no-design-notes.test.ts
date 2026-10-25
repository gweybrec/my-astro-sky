import { describe, expect, it } from 'vitest';
import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The design system's stylesheet comes from the mockups, whose notes track the design rounds ("revision 12", "round D1
// batch 2c", "proposed, not in the code") and dated rules ("user's rule 2026-10-24"). In the app's code these say
// nothing to a reader (the rounds live outside the repository) and some are false; comments describe the rule instead.
const src = join(__dirname, '../src');
const files = globSync('**/*.{css,vue,ts}', { cwd: src }).map((f) => f.replace(/\\/g, '/'));
const NOTES =
  /\b[Rr]evisions? \d+|\bround D\d|\bbatch \d[a-z]?\b|not in the code|user's rule|\(\d{4}-\d{2}-\d{2}\)/;

function notes(text: string): string[] {
  return text
    .split(/\r?\n/)
    .flatMap((line, i) => (NOTES.test(line) ? [`${i + 1}: ${line.trim()}`] : []));
}

describe('the phone app sources', () => {
  it('found the design system stylesheet among the files to check', () => {
    expect(files).toContain('theme/design-system/bundle.css');
  });

  it('flags a design-round note', () => {
    expect(
      notes('/* ok */\n/* Revision 17. A page */\n/* ── Mobile layer, round D1 batch 1 */'),
    ).toHaveLength(2);
  });

  it.each(files)('%s carries no design-round notes', (file) => {
    expect(notes(readFileSync(join(src, file), 'utf8'))).toEqual([]);
  });
});
