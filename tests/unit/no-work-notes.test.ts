// @vitest-environment node
/**
 * Work-item numbers ("WP2.3"), plan phases ("Phase 1") and design revisions ("revision 24") track work that lives
 * outside the repository: in the code and its tests they say nothing to a reader. Comments state the rule instead.
 * The phone app has its own, wider check (`apps/mobile/tests/no-design-notes.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../..');
const files = globSync(
  ['src/**/*.{ts,vue,css}', 'server/**/*.ts', 'packages/*/src/**/*.ts', 'tests/unit/**/*.ts'],
  { cwd: root },
)
  .map((f) => f.replace(/\\/g, '/'))
  .filter((f) => f !== 'tests/unit/no-work-notes.test.ts');
const NOTES = /\bWP\d|\b[Pp]hase \d|\b[Rr]evisions? \d+/;

function notes(text: string): string[] {
  return text
    .split(/\r?\n/)
    .flatMap((line, i) => (NOTES.test(line) ? [`${i + 1}: ${line.trim()}`] : []));
}

describe('the desktop, server and shared package sources and tests', () => {
  it('found the files to check', () => {
    expect(files).toContain('src/MyAstroSkyApp.vue');
    expect(files).toContain('server/index.ts');
    expect(files).toContain('packages/core/src/sky-map-types.ts');
    expect(files).toContain('tests/unit/plan-service.test.ts');
  });

  it('flags a work-item number, a plan phase and a design revision', () => {
    expect(
      notes(
        '// The plan service (WP2.3f)\n// in Phase 1\n// (revision 24)\n// a phase of the moon',
      ),
    ).toHaveLength(3);
  });

  it.each(files)('%s carries no work-tracking notes', (file) => {
    expect(notes(readFileSync(join(root, file), 'utf8'))).toEqual([]);
  });
});
