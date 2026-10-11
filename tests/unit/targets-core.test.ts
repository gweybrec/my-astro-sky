import { describe, it, expect, beforeEach } from 'vitest';
import { configureStorage, createMemoryStore } from '@myastrosky/core/platform/storage';
import type { AccessoryData, CameraData, TelescopeData } from '@myastrosky/core/gear-catalog';
import type { DSO } from '@myastrosky/core/types';
import type { TargetSuggestion } from '@myastrosky/core/target-recommender';
import { loadTargetsPrefs, saveTargetsPrefs } from '@myastrosky/core/targets/prefs';
import {
  formatArcmin,
  formatClock24,
  formatHours,
  minutesToHHMM,
  NIGHT_TIME_OPTIONS,
  snapToObservationTime,
  todayISO,
} from '@myastrosky/core/targets/format';
import { ALL_DSO_TYPES, filterTargetDSOs } from '@myastrosky/core/targets/filters';
import { buildPageList, shuffleArray, sortSuggestions } from '@myastrosky/core/targets/sorting';
import {
  getPlanObserverFor,
  moonEventsInWindow,
  moonSeparationAt,
  nightWindow,
  timeWindowFor,
} from '@myastrosky/core/targets/night';
import { presetForSetupId, resolveSetupById } from '@myastrosky/core/targets/plan-setup';
import { formatMultiplicity } from '@myastrosky/core/targets/multiplicity';
import { matchesTargetQuery } from '@myastrosky/core/targets/query';
import {
  runTargetRecommendation,
  runTargetRecommendationSliced,
} from '@myastrosky/core/targets/recommend';

beforeEach(() => configureStorage(createMemoryStore()));

describe('targets preferences', () => {
  it('defaults when nothing is stored', () => {
    expect(loadTargetsPrefs()).toEqual({ setupId: null, lat: null, lon: null, lastDateISO: null });
  });

  it('round-trips what is saved under the v3 key', () => {
    saveTargetsPrefs({ setupId: 's1', lat: 48.58, lon: 7.75, lastDateISO: null, minAltDeg: 30 });
    expect(loadTargetsPrefs()).toMatchObject({ setupId: 's1', lat: 48.58, minAltDeg: 30 });
  });

  it('migrates the v2 record without its gear fields', () => {
    const store = createMemoryStore();
    store.set(
      'targets-prefs-v2',
      JSON.stringify({ lat: 10, lon: 20, telescopeId: 't', enabledTypes: ['OC'], pageSize: 5 }),
    );
    configureStorage(store);
    expect(loadTargetsPrefs()).toMatchObject({
      setupId: null,
      lat: 10,
      lon: 20,
      enabledTypes: ['OC'],
      pageSize: 5,
    });
    expect(loadTargetsPrefs()).not.toHaveProperty('telescopeId');
  });

  it('falls back to defaults on a corrupt record', () => {
    const store = createMemoryStore();
    store.set('targets-prefs-v3', '{nope');
    configureStorage(store);
    expect(loadTargetsPrefs().setupId).toBeNull();
  });
});

describe('targets formatters and night times', () => {
  it('formats sizes and durations', () => {
    expect(formatArcmin(null)).toBe('—');
    expect(formatArcmin(90)).toBe('1.5°');
    expect(formatArcmin(12)).toBe("12.0'");
    expect(formatHours(0.5)).toBe('30 min');
    expect(formatHours(2.25)).toBe('2.3 h');
    expect(minutesToHHMM(75)).toBe('01:15');
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('snaps to 30 minutes and out of daytime', () => {
    expect(snapToObservationTime('22:10')).toBe('22:00');
    expect(snapToObservationTime('23:50')).toBe('00:00');
    expect(snapToObservationTime('12:00')).toBe('08:00');
    expect(snapToObservationTime('17:00')).toBe('18:00');
  });

  it('lists the night times from 18:00 to 08:00', () => {
    expect(NIGHT_TIME_OPTIONS[0]).toBe('18:00');
    expect(NIGHT_TIME_OPTIONS.at(-1)).toBe('08:00');
    expect(NIGHT_TIME_OPTIONS).toHaveLength(12 + 17);
  });
});

const dso = (id: string, over: Partial<DSO> = {}): DSO =>
  ({
    id,
    ra: 250,
    dec: 36,
    type: 'GC',
    majAxis: 10,
    minAxis: 10,
    pa: 0,
    mag: 6,
    displayName: id,
    catalogs: [id],
    emissionLines: null,
    constellation: 'HER',
    rating: 5,
    difficulty: 2,
    containerId: null,
    priority: 0,
    ...over,
  }) as DSO;

describe('filterTargetDSOs', () => {
  const opts = {
    enabledTypes: new Set<string>(['GC']),
    enabledRatings: new Set([4, 5]),
    enabledDifficulties: new Set([1, 2, 3]),
    enabledCatalogs: new Set<string>(['M', 'NGC', 'IC']),
    photographedIds: null,
    enabledConstellations: null,
  };

  it('keeps the ids of every type in the list order', () => {
    expect(ALL_DSO_TYPES[0]).toBe('GxS');
    expect(ALL_DSO_TYPES).toContain('MS');
  });

  it('filters by type, rating, difficulty, photographed ids and constellation', () => {
    const all = [
      dso('M13'),
      dso('M31', { type: 'GxS' }),
      dso('M3', { rating: 2 }),
      dso('M5', { difficulty: 5 }),
      dso('M92', { constellation: 'LYR' }),
    ];
    expect(filterTargetDSOs(all, opts).map((d) => d.id)).toEqual(['M13', 'M92']);
    expect(
      filterTargetDSOs(all, { ...opts, photographedIds: new Set(['M13']) }).map((d) => d.id),
    ).toEqual(['M92']);
    expect(
      filterTargetDSOs(all, { ...opts, enabledConstellations: new Set(['HER']) }).map((d) => d.id),
    ).toEqual(['M13']);
  });
});

describe('sorting and paging', () => {
  const sug = (id: string, over: Partial<TargetSuggestion> & { dso?: Partial<DSO> } = {}) =>
    ({
      maxAltDeg: 50,
      bestTimeUtc: new Date('2026-06-12T22:00:00Z'),
      score: 1,
      fovFitScore: 0,
      altScore: 0,
      brightnessScore: 0,
      ...over,
      dso: dso(id, over.dso),
    }) as TargetSuggestion;
  const list = [
    sug('M10', { maxAltDeg: 40, score: 3, dso: { mag: 7, rating: 3, majAxis: 5 } }),
    sug('M2', { maxAltDeg: 80, score: 1, dso: { mag: 6, rating: 5, majAxis: 9 } }),
    sug('M1', { maxAltDeg: 60, score: 2, dso: { mag: 8, rating: 4, majAxis: 1 } }),
  ];
  const ids = (key: Parameters<typeof sortSuggestions>[1]) =>
    sortSuggestions(list, key).map((s) => s.dso.id);

  it('sorts by each key without touching the input', () => {
    expect(ids('altitude')).toEqual(['M2', 'M1', 'M10']);
    expect(ids('score')).toEqual(['M10', 'M1', 'M2']);
    expect(ids('magnitude')).toEqual(['M2', 'M10', 'M1']);
    expect(ids('size')).toEqual(['M2', 'M10', 'M1']);
    expect(ids('rating')).toEqual(['M2', 'M1', 'M10']);
    expect(ids('name')).toEqual(['M1', 'M2', 'M10']);
    expect(list.map((s) => s.dso.id)).toEqual(['M10', 'M2', 'M1']);
  });

  it('builds the page list with gaps', () => {
    expect(buildPageList(0, 1)).toEqual([0]);
    expect(buildPageList(0, 5)).toEqual([0, 1, 2, null, 4]);
    expect(buildPageList(10, 20)).toEqual([0, null, 8, 9, 10, 11, 12, null, 19]);
  });

  it('shuffles into a permutation', () => {
    const input = [1, 2, 3, 4, 5, 6];
    expect(shuffleArray(input).sort()).toEqual(input);
  });
});

describe('night and observer helpers', () => {
  it('anchors an observation window to the night', () => {
    expect(timeWindowFor('2026-06-12', null, '02:00')).toBeNull();
    const w = timeWindowFor('2026-06-12', '22:00', '02:00')!;
    expect(w.start.getDate()).toBe(12);
    expect(w.end.getDate()).toBe(13);
    expect(w.end.getTime()).toBeGreaterThan(w.start.getTime());
  });

  it('wraps an end before the start onto the next day', () => {
    const w = timeWindowFor('2026-06-12', '23:00', '22:00')!;
    expect(w.end.getTime() - w.start.getTime()).toBe(23 * 3600 * 1000);
  });

  it('gives a dark window of a few hours at a mid latitude in winter', () => {
    const w = nightWindow({ latDeg: 48, lonDeg: 7 }, new Date('2026-12-01T12:00:00Z'));
    expect(w.end.getTime() - w.start.getTime()).toBeGreaterThan(8 * 3600 * 1000);
  });

  it('falls back to 20:00-06:00 UTC when there is no astronomical night', () => {
    const w = nightWindow({ latDeg: 65, lonDeg: 0 }, new Date('2026-06-21T12:00:00Z'));
    expect(w.start.toISOString()).toBe('2026-06-21T20:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-06-22T06:00:00.000Z');
  });

  it('measures the Moon separation and finds its horizon crossings', () => {
    const sep = moonSeparationAt(10, 10, new Date('2026-06-12T22:00:00Z'));
    expect(sep).toBeGreaterThanOrEqual(0);
    expect(sep).toBeLessThanOrEqual(180);
    const events = moonEventsInWindow(
      { latDeg: 48, lonDeg: 7 },
      { start: new Date('2026-06-12T00:00:00Z'), end: new Date('2026-06-13T00:00:00Z') },
    );
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.type === 'rise' || e.type === 'set')).toBe(true);
  });

  it('prefers the plan location and night, then the global ones', () => {
    const prefs = { lat: 48, lon: 7, lastDateISO: '2026-01-02' };
    expect(getPlanObserverFor({}, prefs)!.loc).toEqual({ latDeg: 48, lonDeg: 7 });
    expect(getPlanObserverFor({}, prefs)!.dateNight.toISOString()).toBe('2026-01-02T12:00:00.000Z');
    const own = getPlanObserverFor({ lat: 10, lon: 20, nightOf: '2026-03-04' }, prefs)!;
    expect(own.loc).toEqual({ latDeg: 10, lonDeg: 20 });
    expect(own.dateNight.toISOString()).toBe('2026-03-04T12:00:00.000Z');
    expect(getPlanObserverFor({}, { lat: null, lon: null, lastDateISO: null })).toBeNull();
    expect(getPlanObserverFor({ lat: 99, lon: 0 }, prefs)).toBeNull();
  });
});

const tel = {
  id: 't1',
  brand: 'B',
  model: 'T',
  aperture_mm: 100,
  focal_length_mm: 500,
  f_ratio: 5,
  is_smart_telescope: false,
  integrated_camera_id: null,
} as TelescopeData;
const cam = {
  id: 'c1',
  brand: 'C',
  model: 'C',
  sensor_width_mm: 10,
  sensor_height_mm: 10,
  pixel_size_um: 5,
  resolution_x: 2000,
  resolution_y: 2000,
  color_type: 'OSC',
} as CameraData;
const gear = {
  setups: [
    { id: 's1', name: 'Setup 1', telescopeId: 't1', cameraId: 'c1', accessoryId: null },
    { id: 's2', name: 'Broken', telescopeId: 'gone', cameraId: 'c1', accessoryId: null },
  ],
  telescopes: [tel],
  cameras: [cam],
  accessories: [] as AccessoryData[],
};

describe('setup resolution', () => {
  it('resolves a setup id to its gear and to a preset', () => {
    expect(resolveSetupById('s1', gear)).toMatchObject({ name: 'Setup 1', tel, cam, acc: null });
    expect(presetForSetupId('s1', gear)).not.toBeNull();
  });

  it('gives null for no id, an unknown id or a setup whose gear is gone', () => {
    expect(resolveSetupById(null, gear)).toBeNull();
    expect(resolveSetupById('zz', gear)).toBeNull();
    expect(presetForSetupId('s2', gear)).toBeNull();
  });
});

describe('runTargetRecommendation', () => {
  const prefs = { setupId: 's1', lat: 45, lon: 5, lastDateISO: null, enabledCatalogs: ['M'] };
  const pool = [dso('M13'), dso('M31', { type: 'GxS', ra: 10.7, dec: 41 })];

  it('reports an invalid location, a missing setup and a window with no dark sky', () => {
    expect(runTargetRecommendation({ prefs: { ...prefs, lat: null }, gear, dsos: pool })).toEqual({
      kind: 'empty',
      reason: 'no-location',
    });
    expect(runTargetRecommendation({ prefs: { ...prefs, lon: 200 }, gear, dsos: pool })).toEqual({
      kind: 'empty',
      reason: 'no-location',
    });
    expect(
      runTargetRecommendation({ prefs: { ...prefs, setupId: 'zz' }, gear, dsos: pool }),
    ).toEqual({ kind: 'empty', reason: 'no-setup' });
    expect(
      runTargetRecommendation({
        prefs: { ...prefs, obsStartTime: '12:00', obsEndTime: '14:00' },
        dateStr: '2026-12-01',
        gear,
        dsos: pool,
      }),
    ).toEqual({ kind: 'empty', reason: 'no-window-overlap' });
  });

  it('returns the objects that pass the filters, with the preset and the night', () => {
    const result = runTargetRecommendation({
      prefs: { ...prefs, enabledTypes: ['GC'], minAltDeg: 10, maxAltDeg: 90 },
      dateStr: '2026-06-12',
      gear,
      dsos: pool,
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.dateStr).toBe('2026-06-12');
    expect(result.location).toEqual({ latDeg: 45, lonDeg: 5 });
    expect(result.suggestions.map((s) => s.dso.id)).not.toContain('M31');
  });

  it('keeps an empty list when nothing matches', () => {
    const result = runTargetRecommendation({
      prefs: { ...prefs, enabledTypes: ['OC'] },
      dateStr: '2026-06-12',
      gear,
      dsos: pool,
    });
    expect(result).toMatchObject({ kind: 'ok', suggestions: [] });
  });

  it('removes the excluded directions and the objects outside the picked region', () => {
    const base = {
      prefs: { ...prefs, enabledTypes: ['GC'], minAltDeg: 0, maxAltDeg: 90 },
      dateStr: '2026-06-12',
      gear,
      dsos: pool,
    };
    const all = runTargetRecommendation(base);
    expect(all.kind === 'ok' && all.suggestions.length).toBeGreaterThan(0);
    const noNorth = runTargetRecommendation({
      ...base,
      prefs: { ...base.prefs, horizonDirs: ['N', 'E', 'W'] },
    });
    expect(noNorth).toMatchObject({ kind: 'ok', suggestions: [] });
    const emptyRegion = runTargetRecommendation({
      ...base,
      prefs: { ...base.prefs, skyRegionId: 'r1' },
      regions: [
        {
          id: 'r1',
          points: [
            { azDeg: 0, altDeg: 1 },
            { azDeg: 1, altDeg: 1 },
            { azDeg: 1, altDeg: 2 },
          ],
        },
      ],
    });
    expect(emptyRegion).toMatchObject({ kind: 'ok', suggestions: [] });
  });
});

describe('matchesTargetQuery', () => {
  const target = dso('NGC7000', {
    displayName: "Nébuleuse de l'Amérique du Nord",
    catalogs: ['NGC7000', 'C20'],
    constellation: 'CYG',
  });

  it('matches the name without accents or case, the designations and the constellation', () => {
    expect(matchesTargetQuery(target, '')).toBe(true);
    expect(matchesTargetQuery(target, 'nebuleuse amerique')).toBe(false);
    expect(matchesTargetQuery(target, 'NEBULEUSE')).toBe(true);
    expect(matchesTargetQuery(target, 'ngc 7000')).toBe(true);
    expect(matchesTargetQuery(target, 'c20')).toBe(true);
    expect(matchesTargetQuery(target, 'cyg')).toBe(true);
    expect(matchesTargetQuery(target, 'M31')).toBe(false);
  });

  it('formats a local time on the 24-hour clock', () => {
    expect(formatClock24(new Date(2026, 5, 12, 2, 5))).toBe('02:05');
    expect(formatClock24(new Date(2026, 5, 12, 23, 40))).toBe('23:40');
  });
});

const tr = (key: string, params?: Record<string, string | number>) =>
  params ? `${key} ${params.n}` : key;

describe('formatMultiplicity', () => {
  it('names the system by its star count and appends the separation', () => {
    expect(formatMultiplicity({ components: 2, sep: '34.3' }, tr)).toContain('34.3″');
    expect(formatMultiplicity({ components: 3 }, tr)).not.toContain('·');
    expect(formatMultiplicity({ components: 12 }, tr)).toContain('12');
  });
});

describe('runTargetRecommendationSliced', () => {
  it('gives the result of the one-go search and yields between slices', async () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      dso(`M${i + 1}`, { ra: 200 + i * 3, dec: 30 + (i % 5) * 3, mag: 5 + (i % 7) }),
    );
    const input = {
      prefs: {
        setupId: 's1',
        lat: 45,
        lon: 5,
        lastDateISO: null,
        enabledTypes: ['GC'],
        enabledCatalogs: ['M'],
        minAltDeg: 10,
        maxAltDeg: 90,
      },
      dateStr: '2026-06-12',
      gear,
      dsos: many,
    };
    let yields = 0;
    const sliced = await runTargetRecommendationSliced(
      input,
      async () => {
        yields++;
      },
      10,
    );
    expect(yields).toBe(3);
    const whole = runTargetRecommendation(input);
    expect(sliced).toEqual(whole);
    expect(whole.kind === 'ok' && whole.suggestions.length).toBeGreaterThan(5);
    expect(
      await runTargetRecommendationSliced(
        { ...input, prefs: { ...input.prefs, lat: null } },
        async () => {},
      ),
    ).toEqual({ kind: 'empty', reason: 'no-location' });
  });
});
