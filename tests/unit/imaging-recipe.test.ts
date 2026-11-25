import { describe, expect, it } from 'vitest';
import type { DSO } from '@myastrosky/core/types';
import type { GearPreset } from '@myastrosky/core/gear-presets';
import {
  MAX_TOTAL_HOURS,
  MIN_SUBS_PER_FILTER,
  recommendRecipe,
} from '@myastrosky/core/imaging-recipe';

function dso(overrides: Partial<DSO> = {}): DSO {
  return {
    id: 'M42',
    ra: 83.82,
    dec: -5.39,
    type: 'EN',
    majAxis: 65,
    minAxis: 60,
    pa: 0,
    mag: 4,
    displayName: 'Orion Nebula',
    catalogs: ['M42'],
    emissionLines: 'Hα',
    constellation: 'Ori',
    rating: 5,
    difficulty: 2,
    ...overrides,
  };
}

/** A 50 mm f/5 smart telescope (Seestar S50, Vespera): built-in colour camera, 10 s subs. */
function smartScope(): GearPreset {
  return preset({
    apertureMm: 50,
    focalLengthMm: 250,
    mono: false,
    builtIn: true,
    maxSubSec: 10,
  });
}

function preset(overrides: Partial<GearPreset> = {}): GearPreset {
  return {
    id: 'test',
    nameKey: 'test',
    apertureMm: 200,
    focalLengthMm: 1000,
    sensorWidthMm: 10,
    sensorHeightMm: 8,
    pixelSizeUm: 4,
    mono: true,
    builtIn: false,
    hasDualBandFilter: false,
    ...overrides,
  };
}

describe('recommendRecipe()', () => {
  it('returns a single RGB filter for non-mono camera', () => {
    const recipe = recommendRecipe(dso(), preset({ mono: false }));

    expect(recipe.filters).toHaveLength(1);
    expect(recipe.filters[0].name).toBe('RGB');
    expect(recipe.noteKeys).toContain('noteColorCamera');
    expect(recipe.totalHours).toBeGreaterThan(0);
  });

  it('returns a single RGB filter for built-in scope even if mono=true', () => {
    const recipe = recommendRecipe(dso(), preset({ mono: true, builtIn: true }));

    expect(recipe.filters).toHaveLength(1);
    expect(recipe.filters[0].name).toBe('RGB');
    expect(recipe.noteKeys).toContain('noteColorCamera');
  });

  it('returns Ha/OIII/SII for mono emission objects', () => {
    const recipe = recommendRecipe(dso({ type: 'EN' }), preset({ mono: true, builtIn: false }));

    expect(recipe.filters.map((f) => f.name)).toEqual(['Ha', 'OIII', 'SII']);
    expect(recipe.noteKeys).toContain('noteNarrowband');
  });

  it('omits SII and adds planetary-nebula note for PN', () => {
    const recipe = recommendRecipe(dso({ type: 'PN', displayName: 'Blue Snowball' }), preset());

    expect(recipe.filters.map((f) => f.name)).toEqual(['Ha', 'OIII']);
    expect(recipe.noteKeys).toContain('noteNarrowband');
    expect(recipe.noteKeys).toContain('notePlanetaryNeb');
  });

  it('uses LRGB for a protoplanetary nebula, even one named "Nébuleuse…"', () => {
    const egg = dso({ type: 'PPN', displayName: "Nébuleuse de l'Œuf", emissionLines: null });
    const recipe = recommendRecipe(egg, preset());

    expect(recipe.filters.map((f) => f.name)).toEqual(['L', 'R', 'G', 'B']);
    expect(recipe.noteKeys).not.toContain('noteNarrowband');
    expect(
      recommendRecipe(egg, preset({ mono: false, hasDualBandFilter: true })).filters[0].name,
    ).toBe('RGB');
  });

  it('gives a protoplanetary nebula the planetary-nebula hours (compact object)', () => {
    const small = smartScope();
    const ppn = recommendRecipe(dso({ type: 'PPN', difficulty: 4, mag: 9 }), small).totalHours;
    const pn = recommendRecipe(dso({ type: 'PN', difficulty: 4, mag: 9 }), small).totalHours;
    expect(ppn).toBe(pn);
  });

  it('uses LRGB for non-emission mono targets (galaxy)', () => {
    const recipe = recommendRecipe(dso({ type: 'GxS', displayName: 'Andromeda Galaxy' }), preset());

    expect(recipe.filters.map((f) => f.name)).toEqual(['L', 'R', 'G', 'B']);
    expect(recipe.noteKeys).not.toContain('noteNarrowband');
  });

  it('still treats "Nebula" displayName as emission when type is not emission', () => {
    const recipe = recommendRecipe(
      dso({ type: 'RN', displayName: 'Reflection Nebula Test' }),
      preset(),
    );

    expect(recipe.filters.map((f) => f.name)).toEqual(['Ha', 'OIII', 'SII']);
  });

  it('adds cluster note for GC/OC in LRGB mode', () => {
    const gcRecipe = recommendRecipe(dso({ type: 'GC', displayName: 'M13' }), preset());
    const ocRecipe = recommendRecipe(dso({ type: 'OC', displayName: 'M45' }), preset());

    expect(gcRecipe.noteKeys).toContain('noteCluster');
    expect(ocRecipe.noteKeys).toContain('noteCluster');
  });

  it('uses fallback magnitude band when difficulty is null', () => {
    const bright = recommendRecipe(dso({ difficulty: null, mag: 6, type: 'GxS' }), preset());
    const medium = recommendRecipe(dso({ difficulty: null, mag: 10, type: 'GxS' }), preset());
    const faint = recommendRecipe(dso({ difficulty: null, mag: 13, type: 'GxS' }), preset());

    expect(bright.totalHours).toBeLessThan(medium.totalHours);
    expect(medium.totalHours).toBeLessThan(faint.totalHours);
  });

  it('scales integration with aperture and clamps to bounds', () => {
    const tinyScope = recommendRecipe(
      dso({ difficulty: 5, type: 'GxS' }),
      preset({ apertureMm: 40 }),
    );
    const hugeScope = recommendRecipe(
      dso({ difficulty: 1, type: 'GxS' }),
      preset({ apertureMm: 1000 }),
    );

    expect(tinyScope.totalHours).toBeLessThanOrEqual(MAX_TOTAL_HOURS);
    expect(hugeScope.totalHours).toBeGreaterThanOrEqual(0.15);
  });

  it('keeps filter-hours sum consistent with totalHours (LRGB path)', () => {
    const recipe = recommendRecipe(dso({ type: 'GxS' }), preset());
    const sum = recipe.filters.reduce((acc, f) => acc + f.hours, 0);

    expect(sum).toBeCloseTo(recipe.totalHours, 10);
  });

  it('caps sub-exposure at maxSubSec for smart scopes', () => {
    // Seestar S50 / Vespera: bright GC would normally yield 120s subs — cap at 10s.
    const recipe = recommendRecipe(
      dso({ type: 'GC', difficulty: 1, mag: 5.8 }),
      preset({ builtIn: true, mono: false, maxSubSec: 10 }),
    );
    expect(recipe.filters).toHaveLength(1);
    expect(recipe.filters[0].name).toBe('RGB');
    expect(recipe.filters[0].subSeconds).toBe(10);
    expect(recipe.filters[0].count).toBeGreaterThan(20); // many short subs
    expect(recipe.totalHours).toBeGreaterThan(0);
  });

  it('does not cap sub-exposure when maxSubSec is absent', () => {
    const recipe = recommendRecipe(
      dso({ type: 'GC', difficulty: 1, mag: 5.8 }),
      preset({ builtIn: true, mono: false }), // no maxSubSec
    );
    expect(recipe.filters[0].subSeconds).toBe(120); // default bright-band value
  });

  it('recommends Dual-Band for emission target on smart scope with dual-band filter', () => {
    const recipe = recommendRecipe(
      dso({ type: 'EN', difficulty: 2, mag: 4 }),
      preset({ builtIn: true, mono: false, hasDualBandFilter: true, maxSubSec: 10 }),
    );
    expect(recipe.filters).toHaveLength(1);
    expect(recipe.filters[0].name).toBe('Dual-Band');
    expect(recipe.filters[0].subSeconds).toBe(10);
    expect(recipe.filters[0].count).toBeGreaterThan(20);
    expect(recipe.noteKeys).toContain('noteDualBand');
    expect(recipe.noteKeys).not.toContain('noteColorCamera');
  });

  it('falls back to RGB for non-emission target on smart scope with dual-band filter', () => {
    const recipe = recommendRecipe(
      dso({ type: 'GC', difficulty: 1, mag: 5.8, displayName: 'M13' }),
      preset({ builtIn: true, mono: false, hasDualBandFilter: true, maxSubSec: 10 }),
    );
    expect(recipe.filters[0].name).toBe('RGB');
    expect(recipe.noteKeys).toContain('noteColorCamera');
    expect(recipe.noteKeys).not.toContain('noteDualBand');
  });

  it('falls back to RGB for emission target on smart scope without dual-band filter', () => {
    const recipe = recommendRecipe(
      dso({ type: 'EN', difficulty: 2, mag: 4 }),
      preset({ builtIn: true, mono: false, hasDualBandFilter: false, maxSubSec: 4 }),
    );
    expect(recipe.filters[0].name).toBe('RGB');
    expect(recipe.noteKeys).not.toContain('noteDualBand');
  });

  it('makes the hardest targets multi-night projects, within the ceiling', () => {
    // Outters 4 / WeDe 1 (PN, difficulty 5) on a C8 used to get 19 min.
    const c8 = preset({ apertureMm: 203 });
    const pn = recommendRecipe(dso({ type: 'PN', difficulty: 5, mag: null }), c8);
    const en = recommendRecipe(dso({ type: 'EN', difficulty: 5, mag: null }), c8);
    expect(pn.totalHours).toBeGreaterThanOrEqual(20);
    expect(en.totalHours).toBeGreaterThanOrEqual(20);
    const small = recommendRecipe(
      dso({ type: 'RN', difficulty: 5, mag: null }),
      preset({ apertureMm: 50 }),
    );
    expect(small.totalHours).toBeLessThanOrEqual(MAX_TOTAL_HOURS);
  });

  it('gives a difficulty-4 nebula more than one night but less than a difficulty 5', () => {
    const at = (difficulty: number) =>
      recommendRecipe(dso({ type: 'EN', difficulty, mag: null }), preset({ apertureMm: 200 }))
        .totalHours;
    expect(at(3)).toBeLessThan(at(4));
    expect(at(4)).toBeGreaterThanOrEqual(6);
    expect(at(4)).toBeLessThan(at(5));
  });

  it('PN at 50 mm takes a few hours, not a night (≤ 3 h)', () => {
    // M57 and M97 (difficulty 1) on a Vespera/S50: compact and bright, the aperture factor is capped.
    const m57 = recommendRecipe(dso({ type: 'PN', difficulty: 1, mag: 8.8 }), smartScope());
    const m97 = recommendRecipe(dso({ type: 'PN', difficulty: 1, mag: 9.9 }), smartScope());

    expect(m57.totalHours).toBeLessThanOrEqual(3);
    expect(m97.totalHours).toBeLessThanOrEqual(3);
  });

  it('galaxy at 50 mm f/5 stays within reasonable bounds (≤ 3.5 h)', () => {
    // NGC4236/M109/NGC4631 (all diff 2) on a Vespera/S50: f/5, so the reference time.
    const ngc4236 = recommendRecipe(dso({ type: 'GxS', difficulty: 2, mag: 9.77 }), smartScope());
    expect(ngc4236.totalHours).toBeLessThanOrEqual(3.5);
  });

  it('scales nebula and galaxy time with the focal ratio, not the aperture', () => {
    const m81 = dso({ type: 'GxS', difficulty: 1, mag: 6.9 });
    const at = (apertureMm: number, focalLengthMm: number) =>
      recommendRecipe(m81, preset({ apertureMm, focalLengthMm, mono: false })).totalHours;
    expect(at(203, 1280)).toBeCloseTo(2 * (1280 / 203 / 5) ** 2, 1); // C8 at f/6.3: about 3 h
    expect(at(203, 2032)).toBeCloseTo(8, 0); // C8 at f/10: four times f/5
    expect(at(100, 500)).toBeCloseTo(at(200, 1000), 6); // same f/5, same time
  });

  it('gives every filter at least 20 subs, shortening them to a usual length first', () => {
    // Wizard Nebula (open cluster in a nebula), mono: a short total split in three filters.
    const wizard = recommendRecipe(
      dso({ type: 'OC', difficulty: 1, mag: 7.2, displayName: 'Wizard Nebula' }),
      preset(),
    );
    for (const f of wizard.filters) {
      expect(f.count).toBeGreaterThanOrEqual(MIN_SUBS_PER_FILTER);
      expect([60, 90, 120, 180, 240, 300, 600, 900]).toContain(f.subSeconds);
    }
  });

  it('gives a cluster inside an emission nebula the nebula hours and filters', () => {
    // Christmas Tree Cluster: an open cluster, but SH2-273 (the Cone) is what gets imaged.
    const christmasTree = dso({
      type: 'OC',
      difficulty: 1,
      mag: 3.9,
      displayName: 'Christmas Tree Cluster',
      catalogs: ['NGC2264', 'LBN911', 'SH2-273'],
    });
    const plainCluster = dso({
      type: 'OC',
      difficulty: 1,
      mag: 3.9,
      displayName: 'M35',
      catalogs: ['M35'],
    });
    const f5 = preset({ focalLengthMm: 1000, apertureMm: 200 });
    const tree = recommendRecipe(christmasTree, f5);
    expect(tree.filters.map((f) => f.name)).toEqual(['Ha', 'OIII', 'SII']);
    expect(tree.totalHours).toBeGreaterThan(recommendRecipe(plainCluster, f5).totalHours);
  });

  it('splits a planetary nebula evenly between Ha and OIII, adding up to the total', () => {
    const recipe = recommendRecipe(dso({ type: 'PN', difficulty: 4, mag: 12 }), preset());
    expect(recipe.filters.map((f) => f.name)).toEqual(['Ha', 'OIII']);
    expect(recipe.filters[0].hours).toBeCloseTo(recipe.filters[1].hours, 6);
    expect(recipe.filters.reduce((a, f) => a + f.hours, 0)).toBeCloseTo(recipe.totalHours, 6);
  });

  it('GC at 50 mm stays within reasonable bounds (≤ 1.5 h)', () => {
    // Vespera / S50 aperture. Without the cluster correction this returned 2 h for diff-1
    // and 6 h for diff-2 (M2), which is unrealistic for a compact bright globular.
    const m13 = recommendRecipe(dso({ type: 'GC', difficulty: 1, mag: 5.8 }), smartScope());
    const m2 = recommendRecipe(dso({ type: 'GC', difficulty: 2, mag: 6.25 }), smartScope());

    expect(m13.totalHours).toBeLessThanOrEqual(1.5);
    expect(m2.totalHours).toBeLessThanOrEqual(1.5);
  });

  it('OC recommendations are shorter than GC at the same difficulty and aperture', () => {
    const gc = recommendRecipe(
      dso({ type: 'GC', difficulty: 2, mag: 6 }),
      preset({ apertureMm: 80 }),
    );
    const oc = recommendRecipe(
      dso({ type: 'OC', difficulty: 2, mag: 6 }),
      preset({ apertureMm: 80 }),
    );

    expect(oc.totalHours).toBeLessThan(gc.totalHours);
  });

  it('keeps filter-hours sum consistent with totalHours (narrowband path)', () => {
    const recipe = recommendRecipe(dso({ type: 'EN' }), preset());
    const sum = recipe.filters.reduce((acc, f) => acc + f.hours, 0);

    expect(sum).toBeCloseTo(recipe.totalHours, 10);
  });

  it('produces positive integer-ish sub counts and valid sub-exposure durations', () => {
    const recipe = recommendRecipe(dso({ type: 'EN' }), preset());

    for (const f of recipe.filters) {
      expect(f.count).toBeGreaterThan(0);
      expect(Number.isInteger(f.count)).toBe(true);
      expect([60, 90, 120, 180, 240, 300, 600, 900].includes(f.subSeconds)).toBe(true);
    }
  });
});
