// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { REEXPORT_EXEMPT } from '../../eslint.config.js';

const root = resolve(__dirname, '../..');

describe('eslint settings', () => {
  // A file moved into a shared package once stayed on this list after it left src/.
  it.each(REEXPORT_EXEMPT)('exempts a file that exists: %s', (file) => {
    expect(existsSync(resolve(root, file))).toBe(true);
  });
});
