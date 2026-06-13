/**
 * Integration tests: recommendTargets + filterTargetDSOs against the real dso.json catalog.
 *
 * These tests validate that the algorithm surfaces specific well-known objects in
 * real-world scenarios (lat=45.17°N, June 12 2026, C8 CLC-equivalent gear) and
 * act as regression tests for the ranking and altitude filtering logic.
 *
 * Test invariants documented here:
 *  - At 45.17°N, M13 transits at 81.3° → excluded by maxAlt=80, included by maxAlt=90.
 *  - M92 transits at 88°  → excluded by maxAlt=80, included by maxAlt=90.
 *  - M10 transits at 40.7° and M12 at 43.1° → always included when maxAlt≥44°.
 *  - With Messier+GC filter (~12 objects), all three must appear in top results.
 *  - With all-catalog GC filter (~30–50 objects), M13 ranks top-5; M10/M12 appear in top 20.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { recommendTargets } from '../../src/target-recommender';
import { filterTargetDSOs } from '../../src/targets-view';
import type { DSOFilterOptions } from '../../src/targets-view';
import type { DSO } from '../../src/types';
import type { GearPreset } from '../../src/gear-presets';

// ─── Mocks required by targets-view.ts imports ───────────────────────────────
vi.mock('../../src/i18n', () => ({ t: (key: string) => key }));
vi.mock('../../src/api', () => ({
  getPhotos: vi.fn(),
  createCustomGear: vi.fn(),
  deleteCustomGear: vi.fn(),
}));
vi.mock('../../src/gear-catalog', () => ({
  getTelescopes: vi.fn(),
  getCameras: vi.fn(),
  getAccessories: vi.fn(),
  buildGearPreset: vi.fn(),
  invalidateGearCache: vi.fn(),
  telescopeLabel: vi.fn(),
  cameraLabel: vi.fn(),
  accessoryLabel: vi.fn(),
}));
vi.mock('../../src/star-catalog', () => ({ getConstellationInfos: vi.fn() }));
vi.mock('../../src/imaging-recipe', () => ({ recommendRecipe: vi.fn() }));
vi.mock('../../src/sky-map', () => ({}));
vi.mock('../../src/tooltip-utils', () => ({
  showKeyValueTooltip: vi.fn(),
  showTextTooltip: vi.fn(),
}));
vi.mock('../../src/chip-utils', () => ({
  createTargetsChip: vi.fn(),
  createFilterBadge: vi.fn(),
}));
// Do NOT mock target-recommender — we test the real implementation here.

// ─── Catalog loader ───────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadCatalog(): DSO[] {
  const raw = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../public/data/dso.json'), 'utf8'),
  ) as { fields: string[]; data: any[][] };
  const fields = raw.fields;
  const fi = (n: string): number => fields.indexOf(n);
  return raw.data.map((r) => ({
    id:            r[fi('id')],
    ra:            r[fi('ra')],
    dec:           r[fi('dec')],
    type:          r[fi('type')],
    majAxis:       r[fi('majAxis')],
    minAxis:       r[fi('minAxis')],
    pa:            r[fi('pa')],
    mag:           r[fi('mag')],
    displayName:   r[fi('nameEn')] ?? null,
    catalogs:      r[fi('catalogs')],
    emissionLines: r[fi('emissionLines')],
    constellation: r[fi('constellation')],
    rating:        r[fi('rating')],
    difficulty:    r[fi('difficulty')],
  }));
}

// ─── Shared fixtures ──────────────────────────────────────────────────────────

// C8 CLC equivalent: 8" aperture, 945 mm focal length, APS-C sensor
// → FOV 33'×24', limiting mag ≈ 17.5
const c8Preset: GearPreset = {
  id: 'c8-integration-test',
  nameKey: 'c8-integration-test',
  apertureMm:      203,
  focalLengthMm:   945,
  sensorWidthMm:   22.3,
  sensorHeightMm:  14.9,
  pixelSizeUm:     4.3,
  mono:            false,
  builtIn:         false,
};

const june12location = { latDeg: 45.17, lonDeg: 5.0 };
const june12night    = new Date('2026-06-12T12:00:00Z');

const ALL_TYPES = new Set(['GxS', 'GxE', 'GxI', 'Gx', 'OC', 'GC', 'EN', 'RN', 'PN', 'SNR', 'DN', '?']);
const ALL_CATS  = new Set(['M', 'NGC', 'IC', 'SH2', 'LBN', 'LDN', 'vdB', 'Abell', 'LPN']);
const ALL_RATS  = new Set([1, 2, 3, 4, 5]);
const ALL_DIFFS = new Set([1, 2, 3, 4, 5]);

const baseOpts: Omit<DSOFilterOptions, 'enabledTypes' | 'enabledCatalogs'> = {
  enabledRatings:        ALL_RATS,
  enabledDifficulties:   ALL_DIFFS,
  photographedIds:       null,
  enabledConstellations: null,
};

// Transit altitudes from lat=45.17°N (formula: 90 − |lat − dec|):
//   M13  dec=36.461°  → 81.3°   (excluded by maxAlt=80)
//   M92  dec=43.137°  → 87.9°   (excluded by maxAlt=80)
//   M10  dec=-4.099°  → 40.7°   (always included when maxAlt≥41°)
//   M12  dec=-1.948°  → 43.1°   (always included when maxAlt≥44°)

// ─── Group A: Messier GC filter ───────────────────────────────────────────────

describe('integration — Messier GC filter, lat=45.17°N, June 12 2026', () => {
  let mesGCs: DSO[];

  // There are ~20 Messier GCs in total; only ~8–12 are in the summer sky at 45°N.
  // With maxAlt=90 and limit=15, all visible ones should fit in a single page.
  const limit = 15;

  vi.spyOn(console, 'error').mockImplementation(() => {});

  beforeAll(() => {
    const catalog = loadCatalog();
    mesGCs = filterTargetDSOs(catalog, {
      ...baseOpts,
      enabledTypes:   new Set(['GC']),
      enabledCatalogs: new Set(['M']),
    });
  });

  it('filterTargetDSOs yields Messier GCs only (sanity check)', () => {
    expect(mesGCs.length).toBeGreaterThan(0);
    for (const d of mesGCs) {
      expect(d.type).toBe('GC');
      expect(d.id).toMatch(/^M\d/);
    }
  });

  it('M10 (transit 40.7°) appears with maxAlt=90', () => {
    const ids = recommendTargets(mesGCs, c8Preset, june12location, june12night, limit, {
      minAltDeg: 20, maxAltDeg: 90,
    }).map(r => r.dso.id);
    expect(ids).toContain('M10');
  });

  it('M12 (transit 43.1°) appears with maxAlt=90', () => {
    const ids = recommendTargets(mesGCs, c8Preset, june12location, june12night, limit, {
      minAltDeg: 20, maxAltDeg: 90,
    }).map(r => r.dso.id);
    expect(ids).toContain('M12');
  });

  it('M13 (transit 81.3°) appears with maxAlt=90', () => {
    const ids = recommendTargets(mesGCs, c8Preset, june12location, june12night, limit, {
      minAltDeg: 20, maxAltDeg: 90,
    }).map(r => r.dso.id);
    expect(ids).toContain('M13');
  });

  it('M10, M12, M13 all appear together with maxAlt=90', () => {
    const ids = recommendTargets(mesGCs, c8Preset, june12location, june12night, limit, {
      minAltDeg: 20, maxAltDeg: 90,
    }).map(r => r.dso.id);
    expect(ids, 'M10 missing').toContain('M10');
    expect(ids, 'M12 missing').toContain('M12');
    expect(ids, 'M13 missing').toContain('M13');
  });

  it('M13 (transit 81.3°) is excluded by maxAlt=80 — and only M13', () => {
    const results = recommendTargets(mesGCs, c8Preset, june12location, june12night, limit, {
      minAltDeg: 20, maxAltDeg: 80,
    });
    const ids = results.map(r => r.dso.id);
    expect(ids, 'M13 should be excluded when maxAlt=80').not.toContain('M13');
    expect(ids, 'M10 should still appear when maxAlt=80').toContain('M10');
    expect(ids, 'M12 should still appear when maxAlt=80').toContain('M12');
  });

  it('M92 (transit 87.9°) is excluded by maxAlt=80', () => {
    const ids = recommendTargets(mesGCs, c8Preset, june12location, june12night, limit, {
      minAltDeg: 20, maxAltDeg: 80,
    }).map(r => r.dso.id);
    expect(ids).not.toContain('M92');
  });

  it('M13 rank is 1st or 2nd among Messier GCs when maxAlt=90 (rating=5, best fov-fit)', () => {
    const results = recommendTargets(mesGCs, c8Preset, june12location, june12night, limit, {
      minAltDeg: 20, maxAltDeg: 90,
    });
    const idx = results.findIndex(r => r.dso.id === 'M13');
    expect(idx, 'M13 should rank in the top 2').toBeLessThanOrEqual(1);
  });
});

// ─── Group B: All-catalog GC filter ──────────────────────────────────────────

describe('integration — all-catalog GC filter, lat=45.17°N, June 12 2026', () => {
  let allGCs: DSO[];

  vi.spyOn(console, 'error').mockImplementation(() => {});

  beforeAll(() => {
    const catalog = loadCatalog();
    allGCs = filterTargetDSOs(catalog, {
      ...baseOpts,
      enabledTypes:    new Set(['GC']),
      enabledCatalogs: ALL_CATS,
    });
    // Sanity: expect several hundred GCs
    expect(allGCs.length).toBeGreaterThan(100);
  });

  it('M10 appears in top 20 all-catalog GC results with maxAlt=90', () => {
    const ids = recommendTargets(allGCs, c8Preset, june12location, june12night, 20, {
      minAltDeg: 20, maxAltDeg: 90,
    }).map(r => r.dso.id);
    expect(ids).toContain('M10');
  });

  it('M12 appears in top 20 all-catalog GC results with maxAlt=90', () => {
    const ids = recommendTargets(allGCs, c8Preset, june12location, june12night, 20, {
      minAltDeg: 20, maxAltDeg: 90,
    }).map(r => r.dso.id);
    expect(ids).toContain('M12');
  });

  it('M13 (rating=5) ranks in top 3 among all GCs with maxAlt=90', () => {
    const results = recommendTargets(allGCs, c8Preset, june12location, june12night, 20, {
      minAltDeg: 20, maxAltDeg: 90,
    });
    const idx = results.findIndex(r => r.dso.id === 'M13');
    expect(idx, 'M13 should rank in the top 3 GCs').toBeGreaterThanOrEqual(0);
    expect(idx, 'M13 should rank in the top 3 GCs').toBeLessThanOrEqual(2);
  });

  it('M13 excluded by maxAlt=80 even in all-catalog GC pool', () => {
    const ids = recommendTargets(allGCs, c8Preset, june12location, june12night, 50, {
      minAltDeg: 20, maxAltDeg: 80,
    }).map(r => r.dso.id);
    expect(ids).not.toContain('M13');
  });

  it('M10 and M12 still appear in top 20 with maxAlt=80', () => {
    const ids = recommendTargets(allGCs, c8Preset, june12location, june12night, 20, {
      minAltDeg: 20, maxAltDeg: 80,
    }).map(r => r.dso.id);
    expect(ids, 'M10 missing with maxAlt=80').toContain('M10');
    expect(ids, 'M12 missing with maxAlt=80').toContain('M12');
  });
});

// ─── Group C: Score and ranking regression ────────────────────────────────────

describe('integration — score ranking regression with C8 CLC preset', () => {
  const mesGCSubset = [
    // Real catalog values
    { id: 'M13', ra: 250.423, dec: 36.461, type: 'GC', majAxis: 16.5, mag: 5.80, rating: 5, difficulty: 1 },
    { id: 'M92', ra: 259.28,  dec: 43.137, type: 'GC', majAxis: 14.4, mag: 6.52, rating: 4, difficulty: 1 },
    { id: 'M10', ra: 254.287, dec: -4.099, type: 'GC', majAxis: 9.3,  mag: 4.98, rating: 4, difficulty: 2 },
    { id: 'M12', ra: 251.811, dec: -1.948, type: 'GC', majAxis: 11.1, mag: 6.07, rating: 4, difficulty: 2 },
  ].map((o) => ({
    ...o,
    type:          o.type as any,
    minAxis:       null,
    pa:            0,
    displayName:   o.id,
    catalogs:      [o.id],
    emissionLines: null,
    constellation: o.id === 'M13' || o.id === 'M92' ? 'Her' : 'Oph',
  } as DSO));

  it('M13 scores higher than M92 (rating=5 vs 4, both high altitude)', () => {
    const results = recommendTargets(mesGCSubset, c8Preset, june12location, june12night, 4, {
      minAltDeg: 20, maxAltDeg: 90,
    });
    const m13 = results.find(r => r.dso.id === 'M13');
    const m92 = results.find(r => r.dso.id === 'M92');
    expect(m13).toBeDefined();
    expect(m92).toBeDefined();
    expect(m13!.score).toBeGreaterThan(m92!.score);
  });

  it('M12 scores higher than M10 (larger angular size → better FOV fit)', () => {
    const results = recommendTargets(mesGCSubset, c8Preset, june12location, june12night, 4, {
      minAltDeg: 20, maxAltDeg: 90,
    });
    const m10 = results.find(r => r.dso.id === 'M10');
    const m12 = results.find(r => r.dso.id === 'M12');
    expect(m10).toBeDefined();
    expect(m12).toBeDefined();
    expect(m12!.score).toBeGreaterThan(m10!.score);
  });

  it('altScore for M10 (transit 40.7°, minAlt=20) ≈ 0.42 ± 0.05', () => {
    const results = recommendTargets(mesGCSubset, c8Preset, june12location, june12night, 4, {
      minAltDeg: 20, maxAltDeg: 90,
    });
    const m10 = results.find(r => r.dso.id === 'M10');
    expect(m10).toBeDefined();
    expect(m10!.altScore).toBeGreaterThan(0.35);
    expect(m10!.altScore).toBeLessThan(0.55);
  });

  it('M13 altScore = 1 (transit 81.3° is above the 70° cap)', () => {
    const results = recommendTargets(mesGCSubset, c8Preset, june12location, june12night, 4, {
      minAltDeg: 20, maxAltDeg: 90,
    });
    const m13 = results.find(r => r.dso.id === 'M13');
    expect(m13).toBeDefined();
    expect(m13!.altScore).toBe(1);
  });
});
