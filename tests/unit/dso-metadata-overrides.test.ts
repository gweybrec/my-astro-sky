import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// generate-dso.mjs applies ONE entry per catalogue object: the entry filed under the
// object's id, else one filed under another of its names (M27 / NGC6853, NGC1909 /
// vdB36…). Any second entry for the same object is silently ignored, so an object
// has exactly one entry, under its main id, listing its other names in `catalogs`.
const OVERRIDES_PATH = path.join(__dirname, '../../scripts/dso-metadata-overrides.json');
const DSO_JSON_PATH = path.join(__dirname, '../../public/data/dso.json');

/** "NGC 6853", "Sh 2-234", "sh2-234" → "NGC6853", "SH2-234". */
const norm = (name: string) =>
  String(name)
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/^SH2?-?(\d)/, 'SH2-$1');

describe('scripts/dso-metadata-overrides.json', () => {
  const entries: { id: string }[] = JSON.parse(fs.readFileSync(OVERRIDES_PATH, 'utf8'));
  const dso: { fields: string[]; data: unknown[][] } = JSON.parse(
    fs.readFileSync(DSO_JSON_PATH, 'utf8'),
  );
  const idxCatalogs = dso.fields.indexOf('catalogs');
  const objectIds = new Set(dso.data.map((row) => norm(String(row[0]))));
  // other name → ids of the objects listing it
  const byOtherName = new Map<string, string[]>();
  for (const row of dso.data) {
    for (const cat of (row[idxCatalogs] as string[] | null) ?? []) {
      const key = norm(cat);
      if (objectIds.has(key)) continue;
      byOtherName.set(key, [...(byOtherName.get(key) ?? []), norm(String(row[0]))]);
    }
  }
  const objectsOf = (id: string) =>
    objectIds.has(norm(id)) ? [norm(id)] : (byOtherName.get(norm(id)) ?? []);

  it('has at most one entry per id', () => {
    const counts = new Map<string, number>();
    for (const e of entries) counts.set(norm(e.id), (counts.get(norm(e.id)) ?? 0) + 1);
    expect([...counts].filter(([, n]) => n > 1).map(([id]) => id)).toEqual([]);
  });

  it('matches every entry to an object of the catalogue', () => {
    expect(entries.filter((e) => objectsOf(e.id).length === 0).map((e) => e.id)).toEqual([]);
  });

  it('has at most one entry per object, counting its other catalogue names', () => {
    const entriesOf = new Map<string, string[]>();
    for (const e of entries) {
      for (const obj of objectsOf(e.id)) entriesOf.set(obj, [...(entriesOf.get(obj) ?? []), e.id]);
    }
    const shared = [...entriesOf]
      .filter(([, ids]) => ids.length > 1)
      .map(([o, ids]) => `${o}: ${ids.join(' + ')}`);
    expect(shared).toEqual([]);
  });
});
