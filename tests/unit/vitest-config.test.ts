// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import config from '../../vitest.config';

const root = resolve(__dirname, '../..');

/** The fixed part of a coverage pattern: the whole path, or the folders before its first wildcard. */
function fixedPart(pattern: string): string {
  const wildcard = pattern.search(/[*?{[]/);
  return wildcard < 0 ? pattern : pattern.slice(0, wildcard).replace(/\/[^/]*$/, '');
}

describe('vitest coverage settings', () => {
  const coverage = config.test?.coverage as { include: string[]; exclude: string[] };

  // Files moved into the shared packages once left their old src/ paths here, so drawing
  // code silently counted against the coverage figures.
  it.each(coverage.exclude.filter((p) => fixedPart(p) !== ''))(
    'excludes a path that exists: %s',
    (pattern) => {
      expect(existsSync(resolve(root, fixedPart(pattern)))).toBe(true);
    },
  );

  it.each(coverage.include)('includes a folder that exists: %s', (pattern) => {
    expect(existsSync(resolve(root, fixedPart(pattern)))).toBe(true);
  });
});
