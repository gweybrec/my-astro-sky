import { describe, it, expect } from 'vitest';
import type { AccessoryData, CameraData, TelescopeData } from '@myastrosky/core/gear-catalog';
import type { DSO } from '@myastrosky/core/types';
import { presetForSetupId } from '@myastrosky/core/targets/plan-setup';
import { nightWindow } from '@myastrosky/core/targets/night';
import {
  buildMoonOverlay,
  computePlanTargets,
  customLocationDso,
  customLocationLabelOr,
  defaultPlanName,
  formatPlanDate,
  moonPhaseForWindow,
  moonSeparationRating,
  planItemCount,
  resolvePlanNight,
  scorePlanEntry,
} from '@myastrosky/core/targets/plan';

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

const loc = { latDeg: 48, lonDeg: 7 };
const win = nightWindow(loc, new Date('2026-12-01T12:00:00Z'));

describe('computePlanTargets', () => {
  const catalog = new Map([
    ['A', dso('A', { ra: 20, dec: 40 })],
    ['B', dso('B', { ra: 100, dec: 20 })],
  ]);
  const lookups = {
    getDsoById: (id: string) => catalog.get(id),
    customLabel: () => 'Étoile',
  };

  it('lists the standalone entries by culmination, skipping mosaic tiles and unplaceable entries', () => {
    const infos = computePlanTargets(
      {
        entries: [
          { id: 'e1', dsoId: 'B', ra: null, dec: null },
          { id: 'e2', dsoId: 'A', ra: null, dec: null },
          { id: 'e3', dsoId: 'A', ra: null, dec: null, mosaicId: 'm1' },
          { id: 'e4', dsoId: 'gone', ra: null, dec: null },
        ],
      },
      loc,
      win,
      true,
      lookups,
    );
    expect(infos.map((i) => i.entryId).sort()).toEqual(['e1', 'e2']);
    for (let i = 1; i < infos.length; i++) {
      expect(infos[i].bestTimeUtc.getTime()).toBeGreaterThanOrEqual(
        infos[i - 1].bestTimeUtc.getTime(),
      );
    }
    expect(infos[0].curve.length).toBeGreaterThan(10);
    expect(infos[0].moonSepDeg).not.toBeNull();
  });

  it('leaves the Moon distance out when the overlay is off', () => {
    const infos = computePlanTargets(
      { entries: [{ id: 'e1', dsoId: 'A', ra: null, dec: null }] },
      loc,
      win,
      false,
      lookups,
    );
    expect(infos[0].moonSepDeg).toBeNull();
  });

  it('uses the frame centre over the DSO position and makes a custom DSO for a frame on empty sky', () => {
    const infos = computePlanTargets(
      { entries: [{ id: 'e1', dsoId: null, ra: 10, dec: 20 }] },
      loc,
      win,
      false,
      lookups,
    );
    expect(infos[0].dso).toMatchObject({ id: 'custom:e1', type: '?', displayName: 'Étoile' });
  });
});

describe('plan helpers', () => {
  it('describes a custom location', () => {
    const d = customLocationDso('x', 10.04, -5.06, 'Lieu');
    expect(d).toMatchObject({ id: 'custom:x', displayName: 'Lieu', catalogs: ['10.0°, -5.1°'] });
    expect(typeof customLocationLabelOr(0, 0, 'Lieu')).toBe('string');
  });

  it('counts a mosaic as one item', () => {
    expect(
      planItemCount({
        entries: [{ mosaicId: null }, { mosaicId: 'm' }, { mosaicId: 'm' }, {}],
        mosaics: [{}],
      }),
    ).toBe(3);
    expect(planItemCount({ entries: [] })).toBe(0);
  });

  it('writes a night as day, short month and year', () => {
    expect(formatPlanDate('2026-10-03', 'fr')).toBe('3 oct. 2026');
  });

  it('names a new plan after its night, in the given locale', () => {
    const t = (key: string, params?: Record<string, string | number>) => `${key}:${params?.date}`;
    expect(defaultPlanName('2026-10-03', t, 'fr')).toBe('targets.plan.defaultName:3 oct. 2026');
    expect(defaultPlanName('2026-10-03', t, 'en-GB')).toContain('2026');
  });

  it('gives the phase of the Moon in the middle of the night', () => {
    const { phaseIndex, illum } = moonPhaseForWindow(win);
    expect(phaseIndex).toBeGreaterThanOrEqual(0);
    expect(phaseIndex).toBeLessThanOrEqual(7);
    expect(illum).toBeGreaterThanOrEqual(0);
    expect(illum).toBeLessThanOrEqual(1);
  });

  it('draws no Moon overlay when it is off, and the curve and phase when it is on', () => {
    expect(buildMoonOverlay(loc, win, false)).toBeNull();
    const day = {
      start: new Date('2026-06-12T09:00:00Z'),
      end: new Date('2026-06-12T11:00:00Z'),
    };
    const overlay = buildMoonOverlay(loc, day, true);
    if (overlay) expect(overlay.curve.some((s) => s.altDeg > 0)).toBe(true);
  });

  it('rates the Moon distance by separation and brightness', () => {
    expect(moonSeparationRating(10, 1)).toMatchObject({
      level: 'danger',
      labelKey: 'targets.plan.moonClose',
      colorToken: '--color-danger',
    });
    expect(moonSeparationRating(170, 1)).toMatchObject({
      level: 'ok',
      labelKey: 'targets.plan.moonFar',
      colorToken: '--status-success-text',
    });
    expect(moonSeparationRating(10, 0.05).level).toBe('ok');
  });
});

describe('scorePlanEntry', () => {
  const tel = {
    id: 't1',
    brand: 'T',
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
    setups: [{ id: 's1', name: 'S', telescopeId: 't1', cameraId: 'c1', accessoryId: null }],
    telescopes: [tel],
    cameras: [cam],
    accessories: [] as AccessoryData[],
  };

  it('gives the score and the field fit as percentages and the recipe of the preset', () => {
    const preset = presetForSetupId('s1', gear)!;
    const r = scorePlanEntry(dso('A'), preset, 70, {});
    expect(Number.isInteger(r.scorePct)).toBe(true);
    expect(r.scorePct).toBeGreaterThanOrEqual(0);
    expect(r.scorePct).toBeLessThanOrEqual(100);
    expect(r.fovFitPct).toBeGreaterThanOrEqual(0);
    expect(r.recipe.totalHours).toBeGreaterThan(0);
  });

  it('ignores the field fit of an oversized target when asked', () => {
    const preset = presetForSetupId('s1', gear)!;
    const big = dso('Big', { majAxis: 600 });
    const strict = scorePlanEntry(big, preset, 70, {});
    const lax = scorePlanEntry(big, preset, 70, { includeOversized: true });
    expect(lax.scorePct).toBeGreaterThanOrEqual(strict.scorePct);
  });
});

describe('resolvePlanNight', () => {
  const catalog = new Map([
    ['A', dso('A', { ra: 20, dec: 40, mag: 9 })],
    ['B', dso('B', { ra: 100, dec: 20, mag: 3 })],
  ]);
  const lookups = { getDsoById: (id: string) => catalog.get(id), customLabel: () => 'Étoile' };
  const plan = {
    nightOf: '2026-12-01',
    entries: [
      { id: 'e1', dsoId: 'A', ra: null, dec: null },
      { id: 'e2', dsoId: 'B', ra: null, dec: null },
    ],
  };
  const prefs = { lat: 48, lon: 7, lastDateISO: null };

  it('is null without a valid location', () => {
    expect(resolvePlanNight(plan, { lat: null, lon: null, lastDateISO: null }, lookups)).toBeNull();
    expect(resolvePlanNight({ ...plan, lat: 95, lon: 0 }, prefs, lookups)).toBeNull();
  });

  it('orders the targets by the plan sort key and uses the plan night', () => {
    const byTransit = resolvePlanNight(plan, prefs, lookups)!;
    expect(byTransit.win.start.toISOString().slice(0, 10)).toBe('2026-12-01');
    expect(byTransit.infos).toHaveLength(2);
    const byMagnitude = resolvePlanNight({ ...plan, sortBy: 'magnitude' }, prefs, lookups)!;
    expect(byMagnitude.infos.map((i) => i.entryId)).toEqual(['e2', 'e1']);
  });

  it('leaves the Moon out when the overlay is off', () => {
    const r = resolvePlanNight(plan, { ...prefs, showMoon: false }, lookups)!;
    expect(r.moon).toBeNull();
    expect(r.infos.every((i) => i.moonSepDeg === null)).toBe(true);
    expect(r.phase.phaseIndex).toBeGreaterThanOrEqual(0);
  });
});
