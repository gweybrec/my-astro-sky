import { describe, expect, it } from 'vitest';
import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import fr from '@myastrosky/core/i18n/mobile/fr';

// Every phone text is named somewhere in the phone or the shared packages, so a text left behind when a screen
// changes is caught (they are translated four times for nothing).
const root = join(__dirname, '../../..');
// Texts whose name is built at run time, by the start of their name.
const BUILT_AT_RUN_TIME = ['mobile.plans.phase'];

function keysOf(obj: object, prefix: string): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === 'object' ? keysOf(v, `${prefix}.${k}`) : [`${prefix}.${k}`],
  );
}

const keys = keysOf(fr, 'mobile');
const code = globSync('{apps/mobile/src,packages/*/src}/**/*.{ts,vue}', { cwd: root })
  .filter((f) => !f.replace(/\\/g, '/').includes('/i18n/'))
  .map((f) => readFileSync(join(root, f), 'utf8'))
  .join('\n');

describe('the phone texts', () => {
  it('found the texts and the code', () => {
    expect(keys.length).toBeGreaterThan(100);
    expect(code).toContain("t('mobile.tabs.sky')");
  });

  it('are each used', () => {
    const unused = keys.filter(
      (k) => !code.includes(k) && !BUILT_AT_RUN_TIME.some((p) => k.startsWith(p)),
    );
    expect(unused).toEqual([]);
  });
});
