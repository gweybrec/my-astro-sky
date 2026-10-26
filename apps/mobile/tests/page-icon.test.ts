import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The phone app's page names its icon, so a browser run (development server, alignment check) does not ask for
// /favicon.ico and log a 404.
const app = join(__dirname, '..');
const html = readFileSync(join(app, 'index.html'), 'utf8');

describe("the phone app's page", () => {
  it('links an icon that exists', () => {
    const href = /<link\s+rel="icon"[^>]*\shref="([^"]+)"/.exec(html)?.[1];
    expect(href).toBeDefined();
    expect(existsSync(join(app, href!))).toBe(true);
  });
});
