import { describe, expect, it } from 'vitest';
import type { DSO } from '../../src/types';
import type { GearPreset } from '../../src/gear-presets';
import { recommendRecipe } from '../../src/imaging-recipe';

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

  it('uses LRGB for non-emission mono targets (galaxy)', () => {
    const recipe = recommendRecipe(dso({ type: 'GxS', displayName: 'Andromeda Galaxy' }), preset());

    expect(recipe.filters.map((f) => f.name)).toEqual(['L', 'R', 'G', 'B']);
    expect(recipe.noteKeys).not.toContain('noteNarrowband');
  });

  it('still treats "Nebula" displayName as emission when type is not emission', () => {
    const recipe = recommendRecipe(dso({ type: 'RN', displayName: 'Reflection Nebula Test' }), preset());

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
    const tinyScope = recommendRecipe(dso({ difficulty: 5, type: 'GxS' }), preset({ apertureMm: 40 }));
    const hugeScope = recommendRecipe(dso({ difficulty: 1, type: 'GxS' }), preset({ apertureMm: 1000 }));

    expect(tinyScope.totalHours).toBeLessThanOrEqual(12);
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

  it('large diffuse nebula (RN/EN) at any aperture never exceeds 6 h', () => {
    // NGC7023 (RN, diff 5, mag null) was hitting the absolute 12 h ceiling.
    const rn = recommendRecipe(dso({ type: 'RN', difficulty: 5, mag: null }), preset({ apertureMm: 50 }));
    const en = recommendRecipe(dso({ type: 'EN', difficulty: 4, mag: 8 }), preset({ apertureMm: 50 }));
    expect(rn.totalHours).toBeLessThanOrEqual(6);
    expect(en.totalHours).toBeLessThanOrEqual(6);
  });

  it('PN at 50 mm stays within reasonable bounds (≤ 1.5 h)', () => {
    // Without the PN correction, M57 (diff 2) and M97 (diff 2) returned 6 h on a Vespera/S50.
    const m57 = recommendRecipe(dso({ type: 'PN', difficulty: 2, mag: 8.8 }), preset({ apertureMm: 50 }));
    const m97 = recommendRecipe(dso({ type: 'PN', difficulty: 2, mag: 9.9 }), preset({ apertureMm: 50 }));

    expect(m57.totalHours).toBeLessThanOrEqual(1.5);
    expect(m97.totalHours).toBeLessThanOrEqual(1.5);
  });

  it('galaxy at 50 mm stays within reasonable bounds (≤ 3.5 h)', () => {
    // Without the galaxy cap, NGC4236/M109/NGC4631 (all diff 2) returned 6 h on a Vespera/S50.
    const ngc4236 = recommendRecipe(
      dso({ type: 'GxS', difficulty: 2, mag: 9.77 }),
      preset({ apertureMm: 50 }),
    );
    expect(ngc4236.totalHours).toBeLessThanOrEqual(3.5);
  });

  it('GC at 50 mm stays within reasonable bounds (≤ 1.5 h)', () => {
    // Vespera / S50 aperture. Without the cluster correction this returned 2 h for diff-1
    // and 6 h for diff-2 (M2), which is unrealistic for a compact bright globular.
    const m13 = recommendRecipe(dso({ type: 'GC', difficulty: 1, mag: 5.8 }), preset({ apertureMm: 50 }));
    const m2 = recommendRecipe(dso({ type: 'GC', difficulty: 2, mag: 6.25 }), preset({ apertureMm: 50 }));

    expect(m13.totalHours).toBeLessThanOrEqual(1.5);
    expect(m2.totalHours).toBeLessThanOrEqual(1.5);
  });

  it('OC recommendations are shorter than GC at the same difficulty and aperture', () => {
    const gc = recommendRecipe(dso({ type: 'GC', difficulty: 2, mag: 6 }), preset({ apertureMm: 80 }));
    const oc = recommendRecipe(dso({ type: 'OC', difficulty: 2, mag: 6 }), preset({ apertureMm: 80 }));

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
      expect([120, 300, 600, 900].includes(f.subSeconds)).toBe(true);
    }
  });
});
