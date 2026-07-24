import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Guards the two invariants the runtime depends on but cannot check itself:
//   1. Every entry carries a valid `color` — badge rendering reads it directly,
//      and a partial `npm run filters:seed` run would leave holes that silently
//      fall back to the generic custom colour.
//   2. The display label (astrobin_name → spcc_name → model) is UNIQUE. That
//      label is what an integration row stores, and it doubles as the lookup key
//      used to resolve a badge colour — a collision would colour a photo's filter
//      with another product's hue.
const FILTERS_PATH = path.join(__dirname, '../../resources/filters.json');

interface FilterEntry {
  id: string;
  brand: string;
  model: string;
  color: string;
  astrobin_name: string | null;
  spcc_name: string | null;
}

const label = (f: FilterEntry) => f.astrobin_name ?? f.spcc_name ?? f.model;

describe('resources/filters.json schema integrity', () => {
  const filters: FilterEntry[] = JSON.parse(fs.readFileSync(FILTERS_PATH, 'utf8'));

  it('has data', () => {
    expect(filters.length).toBeGreaterThan(100);
  });

  it('every entry has an id, brand and model', () => {
    const bad = filters.filter((f) => !f.id || !f.brand || !f.model);
    expect(bad.map((f) => f.id ?? '(no id)')).toEqual([]);
  });

  it('ids are unique', () => {
    const dupes = filters.map((f) => f.id).filter((id, i, arr) => arr.indexOf(id) !== i);
    expect([...new Set(dupes)]).toEqual([]);
  });

  it('every entry has a valid #rrggbb color', () => {
    const bad = filters.filter((f) => !/^#[0-9a-f]{6}$/i.test(f.color ?? ''));
    expect(bad.map((f) => `${f.id}: ${f.color}`)).toEqual([]);
  });

  it('display labels are unique (they are the badge-colour lookup key)', () => {
    const seen = new Map<string, string>();
    const collisions: string[] = [];
    for (const f of filters) {
      const key = label(f).trim().toLowerCase();
      if (seen.has(key)) collisions.push(`${label(f)} (${seen.get(key)} / ${f.id})`);
      else seen.set(key, f.id);
    }
    expect(collisions).toEqual([]);
  });

  it('no display label collides with a generic band name', () => {
    // The Targets "suggested filters" badges deliberately keep generic band names
    // and their legacy --filter-{key} token colours. That separation only holds
    // while no catalog product is literally named "Ha", "L", etc.
    const generic = new Set(['l', 'r', 'g', 'b', 'rgb', 'ha', 'oiii', 'sii', 'dual-band']);
    const clashes = filters.filter((f) => generic.has(label(f).trim().toLowerCase()));
    expect(clashes.map((f) => f.id)).toEqual([]);
  });
});
