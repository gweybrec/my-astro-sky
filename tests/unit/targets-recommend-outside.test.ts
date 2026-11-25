import { describe, it, expect, beforeEach } from 'vitest';
import type { AccessoryData, CameraData, TelescopeData } from '@myastrosky/core/gear-catalog';
import type { DSO } from '@myastrosky/core/types';
import type { TargetsPrefs } from '@myastrosky/core/targets/prefs';
import { runTargetRecommendation } from '@myastrosky/core/targets/recommend';
import { outsideLabels } from '@myastrosky/core/targets/outside';
import { setLang } from '@myastrosky/core/i18n/index';

// A 100 mm f/5 refractor with a 10 mm square sensor: a 1.15° frame.
const gear = {
  setups: [{ id: 's1', name: 'Setup 1', telescopeId: 't1', cameraId: 'c1', accessoryId: null }],
  telescopes: [
    {
      id: 't1',
      aperture_mm: 100,
      focal_length_mm: 500,
      f_ratio: 5,
      is_smart_telescope: false,
      integrated_camera_id: null,
    } as TelescopeData,
  ],
  cameras: [
    {
      id: 'c1',
      sensor_width_mm: 10,
      sensor_height_mm: 10,
      pixel_size_um: 5,
      resolution_x: 2000,
      resolution_y: 2000,
      color_type: 'OSC',
    } as CameraData,
  ],
  accessories: [] as AccessoryData[],
};

const dso = (id: string, ra: number, dec: number, majAxis = 5): DSO =>
  ({
    id,
    ra,
    dec,
    type: 'EN',
    majAxis,
    minAxis: majAxis,
    pa: 0,
    mag: 7,
    displayName: id,
    catalogs: [id],
    emissionLines: null,
    constellation: 'CYG',
    rating: 4,
    difficulty: 2,
  }) as DSO;

// A June night at 45° N, all at RA 18h (due south around midnight): culminations near 89° (dec 44°), 21° (dec -24°), 78° (dec 33°) and 68° (dec 23°).
const DSOS = [
  dso('HIGH', 270, 44.3),
  dso('LOW', 270, -24.4),
  dso('INSIDE', 270, 33.0),
  dso('BIG', 270, 33.0, 120), // 2° in a 1.15° frame: a 2×2 mosaic
  dso('SHOT', 270, 22.7),
];

const prefs = (over: Partial<TargetsPrefs> = {}): TargetsPrefs =>
  ({
    lat: 45,
    lon: 0,
    setupId: 's1',
    enabledTypes: ['EN'],
    minAltDeg: 30,
    maxAltDeg: 80,
    excludePhotographed: true,
    ...over,
  }) as TargetsPrefs;

const run = (p: TargetsPrefs, includeOutside = true) => {
  const r = runTargetRecommendation({
    prefs: p,
    dateStr: '2026-06-21',
    gear,
    dsos: DSOS,
    photographedIds: new Set(['SHOT']),
    includeOutside,
  });
  if (r.kind !== 'ok') throw new Error(r.reason);
  return r;
};
const reasons = (r: ReturnType<typeof run>) =>
  Object.fromEntries(r.outside.map((s) => [s.dso.id, s.outside]));

describe('the search with the objects outside the criteria', () => {
  it('lists apart the objects too high, too low, too big or photographed, with their reasons', () => {
    const r = run(prefs());
    expect(r.suggestions.map((s) => s.dso.id)).toEqual(['INSIDE']);
    expect(reasons(r)).toEqual({
      HIGH: ['too-high'],
      LOW: ['too-low'],
      BIG: ['too-big'],
      SHOT: ['photographed'],
    });
    expect(r.altRange).toEqual({ minAltDeg: 30, maxAltDeg: 80 });
  });

  it('finds the same targets, and nothing apart, when the objects outside are not asked for', () => {
    const r = run(prefs(), false);
    expect(r.suggestions.map((s) => s.dso.id)).toEqual(['INSIDE']);
    expect(r.outside).toEqual([]);
  });

  it('has no photographed or too-big reason when those criteria are off', () => {
    const r = run(prefs({ excludePhotographed: false, includeOversized: true }));
    expect(r.suggestions.map((s) => s.dso.id).sort()).toEqual(['BIG', 'INSIDE', 'SHOT']);
    expect(Object.keys(reasons(r)).sort()).toEqual(['HIGH', 'LOW']);
  });

  it('applies the sky-direction filter to the objects outside too', () => {
    // North of the zenith (dec > 45°): none of these, so only the southern ones remain on both lists.
    const r = run(prefs({ horizonDirs: ['N', 'E', 'W'] }));
    expect(r.suggestions).toEqual([]);
    expect(Object.keys(reasons(r))).toEqual([]);
  });

  it('applies the default altitude range when none is set', () => {
    const r = run(prefs({ minAltDeg: undefined, maxAltDeg: undefined }));
    expect(r.altRange).toEqual({ minAltDeg: 20, maxAltDeg: 80 });
  });
});

describe('outsideLabels', () => {
  beforeEach(() => setLang('fr'));

  it('prints one warning per reason, comparing the altitude with the limit', () => {
    const range = { minAltDeg: 20, maxAltDeg: 80 };
    expect(outsideLabels({ outside: ['too-low'], maxAltDeg: 19.2 }, range)).toEqual([
      'Trop basse · 19° < 20°',
    ]);
    expect(
      outsideLabels({ outside: ['too-high', 'too-big', 'photographed'], maxAltDeg: 83 }, range),
    ).toEqual(['Trop haute · 83° > 80°', 'Trop grande pour le champ', 'Déjà photographiée']);
  });

  it('keeps a decimal when the rounded altitude would read as the limit', () => {
    const range = { minAltDeg: 20, maxAltDeg: 80 };
    expect(outsideLabels({ outside: ['too-high'], maxAltDeg: 80.4 }, range)).toEqual([
      'Trop haute · 80.4° > 80°',
    ]);
  });

  it('prints nothing for a target inside the criteria', () => {
    expect(outsideLabels({ maxAltDeg: 50 }, { minAltDeg: 20, maxAltDeg: 80 })).toEqual([]);
  });
});
