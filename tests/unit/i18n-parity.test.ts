import { describe, it, expect } from 'vitest';
import fr from '../../src/i18n/fr';
import en from '../../src/i18n/en';
import es from '../../src/i18n/es';
import de from '../../src/i18n/de';

// Flatten a nested translation object to the sorted set of its dotted leaf-key paths
// (e.g. `app.title`, `batch.placeButton`). Only string leaves count as keys.
function flattenKeys(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object') return [];
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object') {
      keys.push(...flattenKeys(v, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

const locales = { fr, en, es, de } as const;
type LocaleName = keyof typeof locales;

const keySets: Record<LocaleName, Set<string>> = {
  fr: new Set(flattenKeys(fr)),
  en: new Set(flattenKeys(en)),
  es: new Set(flattenKeys(es)),
  de: new Set(flattenKeys(de)),
};

// French is the source of truth and the runtime fallback (see src/i18n/index.ts `t()`),
// so every other locale is compared against it.
//
// Note: en/es/de are each typed `: Translations` (= `DeepStringify<typeof fr>` in fr.ts),
// so full key parity is *already* enforced at compile time by `npm run typecheck:client`
// — a missing or extra key is a type error. This test is a defense-in-depth backstop:
// it survives the type being weakened (e.g. to `any`/`Partial`) and, unlike a deeply
// nested TS error, prints the exact list of drifted dotted keys.
describe('i18n key parity', () => {
  const names = Object.keys(locales) as LocaleName[];

  it('all locales expose at least one key', () => {
    for (const name of names) {
      expect(keySets[name].size, `${name} has no keys`).toBeGreaterThan(0);
    }
  });

  for (const name of names) {
    if (name === 'fr') continue;

    it(`${name} has exactly the same keys as fr`, () => {
      const missing = [...keySets.fr].filter((k) => !keySets[name].has(k)).sort();
      const extra = [...keySets[name]].filter((k) => !keySets.fr.has(k)).sort();

      expect(
        { missing, extra },
        `\n[${name}] key drift vs fr:\n` +
          `  missing (${missing.length}) — in fr but not ${name}:\n` +
          missing.map((k) => `    - ${k}`).join('\n') +
          `\n  extra (${extra.length}) — in ${name} but not fr:\n` +
          extra.map((k) => `    + ${k}`).join('\n') +
          '\n',
      ).toEqual({ missing: [], extra: [] });
    });
  }
});
