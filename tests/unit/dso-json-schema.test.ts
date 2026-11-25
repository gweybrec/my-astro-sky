import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Guards against a class of regression where `npm run dso:generate` (or a manual
// scripts/generate-dso.mjs run) writes public/data/dso.json without the derived
// columns that scripts/add-ratings.mjs adds (containerId, priority). Since DSO
// rendering gates on `priority` (see src/dso-selection.ts), a silently missing
// column made every DSO fail to render with no console error — see docs/dev/dso-catalog.md.
const DSO_JSON_PATH = path.join(__dirname, '../../public/data/dso.json');

interface DsoJson {
  fields: string[];
  data: unknown[][];
}

const REQUIRED_FIELDS = [
  'id',
  'ra',
  'dec',
  'type',
  'rating',
  'difficulty',
  'containerId',
  'priority',
];

describe('public/data/dso.json schema integrity', () => {
  const raw = fs.readFileSync(DSO_JSON_PATH, 'utf8');
  const dso: DsoJson = JSON.parse(raw);
  const idx = (name: string) => dso.fields.indexOf(name);

  it('has data', () => {
    expect(dso.data.length).toBeGreaterThan(1000);
  });

  it.each(REQUIRED_FIELDS)('declares the "%s" field', (field) => {
    expect(dso.fields).toContain(field);
  });

  it('every row has a finite numeric priority (gates whether a DSO renders at all)', () => {
    const priorityIdx = idx('priority');
    const badRows = dso.data.filter((row) => !Number.isFinite(row[priorityIdx] as number));
    expect(badRows).toHaveLength(0);
  });

  it('priority values form a dense 0..n-1 permutation (no gaps/dupes from a partial run)', () => {
    const priorityIdx = idx('priority');
    const priorities = dso.data.map((row) => row[priorityIdx] as number).sort((a, b) => a - b);
    expect(priorities[0]).toBe(0);
    expect(priorities[priorities.length - 1]).toBe(dso.data.length - 1);
    expect(new Set(priorities).size).toBe(dso.data.length);
  });

  it('every row has an integer rating and difficulty in 1..5', () => {
    const ratingIdx = idx('rating');
    const difficultyIdx = idx('difficulty');
    for (const row of dso.data) {
      expect(row[ratingIdx]).toBeGreaterThanOrEqual(1);
      expect(row[ratingIdx]).toBeLessThanOrEqual(5);
      expect(row[difficultyIdx]).toBeGreaterThanOrEqual(1);
      expect(row[difficultyIdx]).toBeLessThanOrEqual(5);
    }
  });

  it('holds the 16 protoplanetary nebulae, each with a constellation and four names', () => {
    const ppn = dso.data.filter((row) => row[idx('type')] === 'PPN');
    expect(ppn.map((row) => row[idx('id')]).sort()).toEqual(
      [
        'CRL2688',
        'HD44179',
        'IRAS04395+3601',
        'IRAS09371+1212',
        'IRAS12419-5414',
        'IRAS13208-6020',
        'IRAS16594-4656',
        'IRAS17150-3224',
        'IRAS17163-3907',
        'IRAS18059-3211',
        'IRAS19024+0044',
        'IRAS19343+2926',
        'IRAS20068+4051',
        'IRAS22036+5306',
        'IRAS23166+1655',
        'OH231.8+4.2',
      ].sort(),
    );
    for (const row of ppn) {
      expect(row[idx('constellation')]).toMatch(/^[A-Z][a-z]{2}$/);
      for (const f of ['nameFr', 'nameEn', 'nameEs', 'nameDe']) expect(row[idx(f)]).toBeTruthy();
    }
  });

  it('containerId is either null or a non-empty string id', () => {
    const containerIdx = idx('containerId');
    for (const row of dso.data) {
      const v = row[containerIdx];
      expect(v === null || (typeof v === 'string' && v.length > 0)).toBe(true);
    }
  });

  // Difficulty of planetary nebulae comes from surface brightness, and of Sharpless/LBN nebulae from their
  // catalogue's brightness class (scripts/add-ratings.mjs): large faint ones must not read as easy.
  it.each([
    ['Outters4', 5],
    ['WeDe1', 5],
    ['Jones1', 5],
    ['PuWe1', 5],
    ['Abell31', 5],
    ['SH2-129', 5],
  ])('rates the faint %s at difficulty %i', (id, difficulty) => {
    const row = dso.data.find((r) => r[idx('id')] === id)!;
    expect(row[idx('difficulty')]).toBe(difficulty);
  });

  it.each(['M57', 'M27', 'M97', 'NGC6543', 'NGC7000'])('keeps %s easy (difficulty ≤ 2)', (id) => {
    const row = dso.data.find((r) => r[idx('id')] === id)!;
    expect(row[idx('difficulty')] as number).toBeLessThanOrEqual(2);
  });
});
