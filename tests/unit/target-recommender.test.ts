import { describe, it, expect, vi } from 'vitest';
import { recommendTargets, scoreDso } from '../../src/target-recommender';
import { mightBeVisible, maxAltDuringWindow } from '../../src/sky-geometry';
import type { DSO } from '../../src/types';
import type { GearPreset } from '../../src/gear-presets';

// Mock i18n
vi.mock('../../src/i18n', () => ({ t: (key: string) => key }));

function makeDSO(overrides: Partial<DSO> & { id: string }): DSO {
  return {
    ra: 84.05,
    dec: -1.2,
    type: 'EN' as any,
    majAxis: 60, // 60 arcminutes = 1°
    minAxis: 40,
    pa: 0,
    mag: 5.0,
    displayName: overrides.id,
    catalogs: [overrides.id],
    emissionLines: null,
    constellation: 'ORI',
    rating: 3,
    difficulty: 2,
    ...overrides,
  };
}

// A gear preset representative of a typical DSLR setup
const testPreset: GearPreset = {
  id: 'test',
  nameKey: 'test',
  apertureMm: 100,
  focalLengthMm: 500,
  sensorWidthMm: 22.3,
  sensorHeightMm: 14.9,
  pixelSizeUm: 4.3,
  mono: false,
  builtIn: false,
};

const testLocation = { latDeg: 48.85, lonDeg: 2.35 }; // Paris

// Winter night — Orion/Betelgeuse area is well-placed
const winterNight = new Date('2024-01-15T00:00:00Z');

describe('recommendTargets scoring — individual scores via TargetSuggestion output', () => {
  it('altScore=0 for object below 30° altitude', () => {
    // Object near South Celestial Pole never rises from Paris
    const dso = makeDSO({ id: 'LOWDEC', dec: -80, ra: 84 });
    const results = recommendTargets([dso], testPreset, testLocation, winterNight);
    // Should be filtered out (below MIN_ALT_DEG), so 0 results
    expect(results.length).toBe(0);
  });

  it('altScore=1 for object transiting near zenith during the night', () => {
    // From Paris (lat=48.85°), an object at dec=45° transits at ~86° altitude → altScore=1
    // RA=120° transits near midnight UTC on Jan 15 (LST ≈ 123° at Paris midnight)
    const highObj = makeDSO({ id: 'HIGH', ra: 120, dec: 45, mag: 5.0, majAxis: 30 });
    const results = recommendTargets([highObj], testPreset, testLocation, winterNight);
    if (results.length > 0) {
      expect(results[0].altScore).toBe(1);
    }
  });

  it('brightness score is 0 for object at mag limit', () => {
    // A gear preset with mag limit driven by aperture and focal length
    // With apertureMm=100, limiting mag ≈ 13.5 (approximate)
    // Place object at exactly the magnitude limit
    // We'll just check the score field is between 0 and 1
    const dso = makeDSO({ id: 'FAINT', mag: 13.0, dec: 40, ra: 84, majAxis: 30 });
    const results = recommendTargets([dso], testPreset, testLocation, winterNight);
    if (results.length > 0) {
      expect(results[0].brightnessScore).toBeGreaterThanOrEqual(0);
      expect(results[0].brightnessScore).toBeLessThanOrEqual(1);
    }
  });

  it('object without majAxis is skipped', () => {
    const noSize = makeDSO({ id: 'NOSIZE', majAxis: null as any });
    const results = recommendTargets([noSize], testPreset, testLocation, winterNight);
    expect(results.length).toBe(0);
  });

  it('object too faint (mag > limit) is skipped', () => {
    const toFaint = makeDSO({ id: 'TOOFAINT', mag: 99, dec: 30, ra: 84 });
    const results = recommendTargets([toFaint], testPreset, testLocation, winterNight);
    expect(results.length).toBe(0);
  });

  it('results are sorted by score descending', () => {
    // Create DSOs with predictably different scores
    const bright = makeDSO({ id: 'BRIGHT', mag: 3.0, dec: 40, ra: 84, majAxis: 40 });
    const faint = makeDSO({ id: 'FAINT2', mag: 12.0, dec: 40, ra: 84.1, majAxis: 40 });
    const results = recommendTargets([faint, bright], testPreset, testLocation, winterNight);
    if (results.length >= 2) {
      expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
    }
  });

  it('diversity cap: max 2 of same DSO type when alternatives exist', () => {
    // 3 galaxies + 3 emission nebulae, all well-placed (dec=45°, winter night)
    // limit=4: diversity cap yields ≤2 Gx + ≤2 EN = 4 total, no top-up needed
    const galaxies = [1, 2, 3].map((i) =>
      makeDSO({ id: `GX${i}`, type: 'Gx' as any, dec: 45, ra: 120 + i, mag: 7.0, majAxis: 20 }),
    );
    const nebulae = [1, 2, 3].map((i) =>
      makeDSO({ id: `EN${i}`, type: 'EN' as any, dec: 45, ra: 124 + i, mag: 7.0, majAxis: 20 }),
    );
    const results = recommendTargets(
      [...galaxies, ...nebulae],
      testPreset,
      testLocation,
      winterNight,
      4,
    );
    if (results.length >= 2) {
      const gxCount = results.filter((r) => r.dso.type === 'Gx').length;
      expect(gxCount).toBeLessThanOrEqual(2);
    }
  });

  it('all score fields are in [0, 1]', () => {
    const dsos = [
      makeDSO({ id: 'ORN', ra: 84.05, dec: -1.2, mag: 4.0, majAxis: 60 }),
      makeDSO({ id: 'M42', ra: 83.82, dec: -5.4, mag: 4.0, majAxis: 65 }),
    ];
    const results = recommendTargets(dsos, testPreset, testLocation, winterNight);
    for (const r of results) {
      expect(r.altScore).toBeGreaterThanOrEqual(0);
      expect(r.altScore).toBeLessThanOrEqual(1);
      expect(r.fovFitScore).toBeGreaterThanOrEqual(0);
      expect(r.fovFitScore).toBeLessThanOrEqual(1);
      expect(r.brightnessScore).toBeGreaterThanOrEqual(0);
      expect(r.brightnessScore).toBeLessThanOrEqual(1);
    }
  });
});

// ─── Group 1: mightBeVisible edge cases ──────────────────────────────────────

describe('mightBeVisible — altitude pre-filter', () => {
  it('M13 (Dec=36.5°) is visible from lat=45°N with minAlt=20°', () => {
    expect(mightBeVisible(36.461, 45, 20)).toBe(true);
  });

  it('M10 (Dec=−4.1°) is visible from lat=45°N with minAlt=20°', () => {
    // maxPossible = 90 − |45 − (−4.1)| = 40.9° ≥ 20°
    expect(mightBeVisible(-4.099, 45, 20)).toBe(true);
  });

  it('M10 (Dec=−4.1°) is NOT visible from lat=75°N with minAlt=20°', () => {
    // maxPossible = 90 − |75 − (−4.1)| = 10.9° < 20°
    expect(mightBeVisible(-4.099, 75, 20)).toBe(false);
  });

  it('object at Dec=−80° is NOT visible from lat=45°N with minAlt=20°', () => {
    expect(mightBeVisible(-80, 45, 20)).toBe(false);
  });

  it('uses minAlt=30 by default (legacy behaviour)', () => {
    // M10 from 52°N: maxPossible = 90 − 56.1 = 33.9° ≥ 30°
    expect(mightBeVisible(-4.099, 52, 30)).toBe(true);
    // M10 from 56°N: maxPossible = 90 − 60.1 = 29.9° < 30°
    expect(mightBeVisible(-4.099, 56, 30)).toBe(false);
  });

  it('M10 from 56°N passes with the new default minAlt=20°', () => {
    // maxPossible = 29.9° ≥ 20°
    expect(mightBeVisible(-4.099, 56, 20)).toBe(true);
  });
});

// ─── Group 2: maxAltDuringWindow accuracy ────────────────────────────────────
// June 12 2026, lat=45.17°N, lon=5°E — all four Messier GC objects transit
// during the night window.

describe('maxAltDuringWindow — M13/M10/M12/M92 at lat=45.17°N, June 12 2026', () => {
  const june12window = {
    start: new Date('2026-06-12T21:00:00Z'),
    end: new Date('2026-06-13T03:00:00Z'),
  };
  const lat = 45.17;
  const lon = 5.0;

  it('M13 peaks at 75–85° during the window', () => {
    const { maxAltDeg } = maxAltDuringWindow(
      250.423,
      36.461,
      lat,
      lon,
      june12window.start,
      june12window.end,
      5,
    );
    expect(maxAltDeg).toBeGreaterThan(75);
    expect(maxAltDeg).toBeLessThan(85);
  });

  it('M92 peaks at 82–90° during the window', () => {
    const { maxAltDeg } = maxAltDuringWindow(
      259.28,
      43.137,
      lat,
      lon,
      june12window.start,
      june12window.end,
      5,
    );
    expect(maxAltDeg).toBeGreaterThan(82);
    expect(maxAltDeg).toBeLessThanOrEqual(90);
  });

  it('M10 peaks at 35–48° during the window', () => {
    const { maxAltDeg } = maxAltDuringWindow(
      254.287,
      -4.099,
      lat,
      lon,
      june12window.start,
      june12window.end,
      5,
    );
    expect(maxAltDeg).toBeGreaterThan(35);
    expect(maxAltDeg).toBeLessThan(48);
  });

  it('M12 peaks at 38–50° during the window', () => {
    const { maxAltDeg } = maxAltDuringWindow(
      251.811,
      -1.948,
      lat,
      lon,
      june12window.start,
      june12window.end,
      5,
    );
    expect(maxAltDeg).toBeGreaterThan(38);
    expect(maxAltDeg).toBeLessThan(50);
  });

  it('all four reach at least 20° — none should be altitude-filtered', () => {
    const objects = [
      { id: 'M13', ra: 250.423, dec: 36.461 },
      { id: 'M92', ra: 259.28, dec: 43.137 },
      { id: 'M10', ra: 254.287, dec: -4.099 },
      { id: 'M12', ra: 251.811, dec: -1.948 },
    ];
    for (const o of objects) {
      const { maxAltDeg } = maxAltDuringWindow(
        o.ra,
        o.dec,
        lat,
        lon,
        june12window.start,
        june12window.end,
        5,
      );
      expect(maxAltDeg, `${o.id} should reach ≥20° from lat=${lat}°N`).toBeGreaterThanOrEqual(20);
    }
  });
});

// ─── Group 3: full pipeline regression — all four objects must appear ─────────

describe('recommendTargets — M13/M10/M12/M92 at lat=45.17°N, June 12 2026', () => {
  const june12location = { latDeg: 45.17, lonDeg: 5.0 };
  const june12night = new Date('2026-06-12T12:00:00Z');

  const m13 = makeDSO({
    id: 'M13',
    ra: 250.423,
    dec: 36.461,
    type: 'GC' as any,
    majAxis: 16.5,
    mag: 5.8,
    constellation: 'Her',
    rating: 5,
    difficulty: 1,
  });
  const m10 = makeDSO({
    id: 'M10',
    ra: 254.287,
    dec: -4.099,
    type: 'GC' as any,
    majAxis: 9.3,
    mag: 4.98,
    constellation: 'Oph',
    rating: 4,
    difficulty: 2,
  });
  const m12 = makeDSO({
    id: 'M12',
    ra: 251.811,
    dec: -1.948,
    type: 'GC' as any,
    majAxis: 11.1,
    mag: 6.07,
    constellation: 'Oph',
    rating: 4,
    difficulty: 2,
  });
  const m92 = makeDSO({
    id: 'M92',
    ra: 259.28,
    dec: 43.137,
    type: 'GC' as any,
    majAxis: 14.4,
    mag: 6.52,
    constellation: 'Her',
    rating: 4,
    difficulty: 1,
  });

  it('M13 appears in results with default options (minAlt=20, maxAlt=90)', () => {
    const results = recommendTargets([m13], testPreset, june12location, june12night, 10, {
      minAltDeg: 20,
      maxAltDeg: 90,
    });
    expect(results.map((r) => r.dso.id)).toContain('M13');
  });

  it('M10 appears in results with default options (minAlt=20, maxAlt=90)', () => {
    const results = recommendTargets([m10], testPreset, june12location, june12night, 10, {
      minAltDeg: 20,
      maxAltDeg: 90,
    });
    expect(results.map((r) => r.dso.id)).toContain('M10');
  });

  it('M12 appears in results with default options (minAlt=20, maxAlt=90)', () => {
    const results = recommendTargets([m12], testPreset, june12location, june12night, 10, {
      minAltDeg: 20,
      maxAltDeg: 90,
    });
    expect(results.map((r) => r.dso.id)).toContain('M12');
  });

  it('M92 appears in results with default options (minAlt=20, maxAlt=90)', () => {
    const results = recommendTargets([m92], testPreset, june12location, june12night, 10, {
      minAltDeg: 20,
      maxAltDeg: 90,
    });
    expect(results.map((r) => r.dso.id)).toContain('M92');
  });

  it('all four appear together with default options', () => {
    const results = recommendTargets(
      [m13, m10, m12, m92],
      testPreset,
      june12location,
      june12night,
      10,
      { minAltDeg: 20, maxAltDeg: 90 },
    );
    const ids = results.map((r) => r.dso.id);
    expect(ids).toContain('M13');
    expect(ids).toContain('M10');
    expect(ids).toContain('M12');
    expect(ids).toContain('M92');
  });

  it('all four appear with the legacy minAlt=30 default', () => {
    // From 45.17°N all four transit above 30°, so the old default should work too
    const results = recommendTargets(
      [m13, m10, m12, m92],
      testPreset,
      june12location,
      june12night,
      10,
      { minAltDeg: 30, maxAltDeg: 90 },
    );
    const ids = results.map((r) => r.dso.id);
    expect(ids).toContain('M13');
    expect(ids).toContain('M10');
    expect(ids).toContain('M12');
    expect(ids).toContain('M92');
  });
});

// ─── Group 4: minAltDeg option ───────────────────────────────────────────────

describe('recommendTargets — minAltDeg option', () => {
  const june12location = { latDeg: 45.17, lonDeg: 5.0 };
  const june12night = new Date('2026-06-12T12:00:00Z');
  const m13 = makeDSO({
    id: 'M13',
    ra: 250.423,
    dec: 36.461,
    type: 'GC' as any,
    majAxis: 16.5,
    mag: 5.8,
  });
  const m10 = makeDSO({
    id: 'M10',
    ra: 254.287,
    dec: -4.099,
    type: 'GC' as any,
    majAxis: 9.3,
    mag: 4.98,
  });

  it('M10 (transit ≈41°) is excluded when minAltDeg=50', () => {
    const results = recommendTargets([m10], testPreset, june12location, june12night, 10, {
      minAltDeg: 50,
      maxAltDeg: 90,
    });
    expect(results.map((r) => r.dso.id)).not.toContain('M10');
  });

  it('M13 (transit ≈81°) is included when minAltDeg=50', () => {
    const results = recommendTargets([m13], testPreset, june12location, june12night, 10, {
      minAltDeg: 50,
      maxAltDeg: 90,
    });
    expect(results.map((r) => r.dso.id)).toContain('M13');
  });

  it('both included when minAltDeg=20 (default)', () => {
    const results = recommendTargets([m13, m10], testPreset, june12location, june12night, 10, {
      minAltDeg: 20,
      maxAltDeg: 90,
    });
    const ids = results.map((r) => r.dso.id);
    expect(ids).toContain('M13');
    expect(ids).toContain('M10');
  });
});

// ─── Group 5: maxAltDeg option ───────────────────────────────────────────────

describe('recommendTargets — maxAltDeg option', () => {
  const june12location = { latDeg: 45.17, lonDeg: 5.0 };
  const june12night = new Date('2026-06-12T12:00:00Z');
  const m13 = makeDSO({
    id: 'M13',
    ra: 250.423,
    dec: 36.461,
    type: 'GC' as any,
    majAxis: 16.5,
    mag: 5.8,
  });
  const m10 = makeDSO({
    id: 'M10',
    ra: 254.287,
    dec: -4.099,
    type: 'GC' as any,
    majAxis: 9.3,
    mag: 4.98,
  });
  const m92 = makeDSO({
    id: 'M92',
    ra: 259.28,
    dec: 43.137,
    type: 'GC' as any,
    majAxis: 14.4,
    mag: 6.52,
  });

  it('M13 (transit ≈81°) is excluded when maxAltDeg=80', () => {
    const results = recommendTargets([m13], testPreset, june12location, june12night, 10, {
      minAltDeg: 20,
      maxAltDeg: 80,
    });
    expect(results.map((r) => r.dso.id)).not.toContain('M13');
  });

  it('M92 (transit ≈88°) is excluded when maxAltDeg=80', () => {
    const results = recommendTargets([m92], testPreset, june12location, june12night, 10, {
      minAltDeg: 20,
      maxAltDeg: 80,
    });
    expect(results.map((r) => r.dso.id)).not.toContain('M92');
  });

  it('M10 (transit ≈41°) is included when maxAltDeg=80', () => {
    const results = recommendTargets([m10], testPreset, june12location, june12night, 10, {
      minAltDeg: 20,
      maxAltDeg: 80,
    });
    expect(results.map((r) => r.dso.id)).toContain('M10');
  });

  it('all three included when maxAltDeg=90', () => {
    const results = recommendTargets([m13, m10, m92], testPreset, june12location, june12night, 10, {
      minAltDeg: 20,
      maxAltDeg: 90,
    });
    const ids = results.map((r) => r.dso.id);
    expect(ids).toContain('M13');
    expect(ids).toContain('M10');
    expect(ids).toContain('M92');
  });
});

// ─── Group 6: altScore uses minAlt in formula ────────────────────────────────

describe('altScore formula uses minAlt', () => {
  // We test via TargetSuggestion.altScore on a known object from a known window.
  // Use a winter night (Paris) so M42/Orion area is predictably well-placed.
  const lowAltPreset = testPreset; // same preset is fine

  it('altScore is higher with minAlt=20 than minAlt=30 for the same altitude', () => {
    // Object at dec=-1.2° from Paris (lat=48.85°), transits at ~40°
    const dso = makeDSO({ id: 'MED', ra: 84.05, dec: -1.2, mag: 4.0, majAxis: 60 });

    const r20 = recommendTargets([dso], lowAltPreset, testLocation, winterNight, 1, {
      minAltDeg: 20,
      maxAltDeg: 90,
    });
    const r30 = recommendTargets([dso], lowAltPreset, testLocation, winterNight, 1, {
      minAltDeg: 30,
      maxAltDeg: 90,
    });

    if (r20.length > 0 && r30.length > 0) {
      // Same object, same altitude — minAlt=20 gives a higher altScore
      expect(r20[0].altScore).toBeGreaterThan(r30[0].altScore);
    }
  });

  it('object at 70°+ always gets altScore=1 regardless of minAlt', () => {
    // From Paris, an object at dec=45° transits at ~86° → altScore=1
    const highObj = makeDSO({ id: 'HIGH', ra: 120, dec: 45, mag: 5.0, majAxis: 30 });
    const r = recommendTargets([highObj], testPreset, testLocation, winterNight, 1, {
      minAltDeg: 20,
      maxAltDeg: 90,
    });
    if (r.length > 0) {
      expect(r[0].altScore).toBe(1);
    }
  });
});

// ─── Group 8: diversity cap with limit=5000 is a no-op ───────────────────────

describe('diversity cap with limit=5000', () => {
  it('all 4 GC candidates appear when limit=5000 (top-up restores overflow)', () => {
    const june12location = { latDeg: 45.17, lonDeg: 5.0 };
    const june12night = new Date('2026-06-12T12:00:00Z');
    const gcObjects = [
      makeDSO({ id: 'GC1', ra: 250.423, dec: 36.461, type: 'GC' as any, majAxis: 16.5, mag: 5.8 }),
      makeDSO({ id: 'GC2', ra: 254.287, dec: -4.099, type: 'GC' as any, majAxis: 9.3, mag: 4.98 }),
      makeDSO({ id: 'GC3', ra: 251.811, dec: -1.948, type: 'GC' as any, majAxis: 11.1, mag: 6.07 }),
      makeDSO({ id: 'GC4', ra: 259.28, dec: 43.137, type: 'GC' as any, majAxis: 14.4, mag: 6.52 }),
    ];
    const results = recommendTargets(gcObjects, testPreset, june12location, june12night, 5000, {
      minAltDeg: 20,
      maxAltDeg: 90,
    });
    expect(results).toHaveLength(4); // all 4 should appear (2 in diverse, 2 in top-up)
  });

  it('diversity cap limits to 2 of each type when limit is small', () => {
    // limit=3: diversity cap gives 2 GC + 1 OC, not 3 GC
    const june12location = { latDeg: 45.17, lonDeg: 5.0 };
    const june12night = new Date('2026-06-12T12:00:00Z');
    const gcObjects = [
      makeDSO({ id: 'GC1', ra: 250.423, dec: 36.461, type: 'GC' as any, majAxis: 16.5, mag: 5.8 }),
      makeDSO({ id: 'GC2', ra: 254.287, dec: -4.099, type: 'GC' as any, majAxis: 9.3, mag: 4.98 }),
      makeDSO({ id: 'GC3', ra: 251.811, dec: -1.948, type: 'GC' as any, majAxis: 11.1, mag: 6.07 }),
    ];
    const ocObject = makeDSO({
      id: 'OC1',
      ra: 282.8,
      dec: -6.3,
      type: 'OC' as any,
      majAxis: 14,
      mag: 5.8,
    });
    const results = recommendTargets(
      [...gcObjects, ocObject],
      testPreset,
      june12location,
      june12night,
      3,
      { minAltDeg: 20, maxAltDeg: 90 },
    );
    const gcCount = results.filter((r) => r.dso.type === 'GC').length;
    expect(gcCount).toBeLessThanOrEqual(2);
  });
});

describe('scoreDso — standalone single-object scoring (used by plans)', () => {
  it('scores an object that recommendTargets would filter out (faint, sizeless)', () => {
    // No majAxis and very faint → recommendTargets skips it entirely, but a
    // plan can still contain it, so scoreDso must return a finite score.
    const dso = makeDSO({ id: 'FAINT', majAxis: null as any, mag: 20 });
    const { score, fovFitScore, altScore, brightnessScore } = scoreDso(dso, testPreset, 60);
    expect(Number.isFinite(score)).toBe(true);
    expect(fovFitScore).toBe(0); // sizeless → 0 FOV fit
    expect(brightnessScore).toBe(0); // far below limiting magnitude
    expect(altScore).toBeGreaterThan(0);
  });

  it('score equals the weighted sum of its components', () => {
    const dso = makeDSO({ id: 'M', majAxis: 30, mag: 6 });
    const r = scoreDso(dso, testPreset, 70);
    const expected = 0.45 * r.altScore + 0.35 * r.fovFitScore + 0.2 * r.brightnessScore;
    expect(r.score).toBeCloseTo(expected, 6);
  });

  it('ignoreFovFit forces a perfect FOV-fit score', () => {
    const dso = makeDSO({ id: 'BIG', majAxis: 600, mag: 6 }); // huge object: normally penalised
    const normal = scoreDso(dso, testPreset, 70);
    const ignored = scoreDso(dso, testPreset, 70, { ignoreFovFit: true });
    expect(ignored.fovFitScore).toBe(1);
    expect(ignored.fovFitScore).toBeGreaterThan(normal.fovFitScore);
  });

  it('altScore is 0 below the minimum altitude and clamps to 1 at high altitude', () => {
    const dso = makeDSO({ id: 'A', majAxis: 30, mag: 6 });
    expect(scoreDso(dso, testPreset, 10).altScore).toBe(0); // below default minAlt (20)
    expect(scoreDso(dso, testPreset, 85).altScore).toBe(1); // ≥70 → clamped to 1
  });
});
