import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ERROR_CODES } from '../../packages/core/src/domain/error-codes';
import fr from '../../packages/core/src/i18n/fr';
import en from '../../packages/core/src/i18n/en';
import es from '../../packages/core/src/i18n/es';
import de from '../../packages/core/src/i18n/de';

const LANGUAGES = { fr, en, es, de } as const;
const ROOT = resolve(__dirname, '../..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== 'i18n' && name !== 'node_modules') out.push(...sourceFiles(path));
    } else if (path.endsWith('.ts')) {
      out.push(path);
    }
  }
  return out;
}

describe('ERROR_CODES and the serverErrors messages', () => {
  it('has no duplicate code', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });

  for (const [lang, translations] of Object.entries(LANGUAGES)) {
    describe(lang, () => {
      const messages = translations.serverErrors as Record<string, string>;

      it('has a message for every code', () => {
        const missing = ERROR_CODES.filter((code) => !messages[code]);
        expect(missing).toEqual([]);
      });

      it('has no message for a code that nothing can produce', () => {
        const known = new Set<string>(ERROR_CODES);
        expect(Object.keys(messages).filter((key) => !known.has(key))).toEqual([]);
      });
    });
  }

  it('keeps the same placeholders in the four languages', () => {
    const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
    for (const code of ERROR_CODES) {
      const expected = placeholders((fr.serverErrors as Record<string, string>)[code]);
      for (const translations of [en, es, de]) {
        expect(placeholders((translations.serverErrors as Record<string, string>)[code])).toEqual(
          expected,
        );
      }
    }
  });

  it('lists every code literal found in the core and server sources', () => {
    const known = new Set<string>(ERROR_CODES);
    const found = new Set<string>();
    const literal = /\bcode(?::| =)\s*'([A-Z][A-Z0-9_]+)'/g;
    for (const dir of ['packages/core/src', 'server']) {
      for (const file of sourceFiles(join(ROOT, dir))) {
        for (const match of readFileSync(file, 'utf8').matchAll(literal)) found.add(match[1]);
      }
    }
    expect(found.size).toBeGreaterThan(40);
    expect([...found].filter((code) => !known.has(code))).toEqual([]);
  });
});
