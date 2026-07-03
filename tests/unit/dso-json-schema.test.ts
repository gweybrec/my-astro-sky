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

  it('containerId is either null or a non-empty string id', () => {
    const containerIdx = idx('containerId');
    for (const row of dso.data) {
      const v = row[containerIdx];
      expect(v === null || (typeof v === 'string' && v.length > 0)).toBe(true);
    }
  });
});
