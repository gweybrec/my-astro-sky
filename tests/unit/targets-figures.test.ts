import { describe, it, expect } from 'vitest';
import type { DSO } from '@myastrosky/core/types';
import type { GearPreset } from '@myastrosky/core/gear-presets';
import { targetFigures } from '@myastrosky/core/targets/figures';
import { scoreDso } from '@myastrosky/core/target-recommender';
import { twilightWindow } from '@myastrosky/core/astro-time';
import { maxAltDuringWindow } from '@myastrosky/core/sky-geometry';

const M31 = {
  id: 'M31',
  ra: 10.68,
  dec: 41.27,
  type: 'GxS',
  majAxis: 190,
  minAxis: 60,
  mag: 3.4,
  catalogs: ['M31'],
} as unknown as DSO;

const REFRACTOR = {
  apertureMm: 80,
  focalLengthMm: 400,
  sensorWidthMm: 23.5,
  sensorHeightMm: 15.6,
  pixelSizeUm: 3.76,
  mono: false,
  builtIn: false,
} as GearPreset;

const STRASBOURG = { lat: 48.58, lon: 7.75, date: new Date('2026-10-15T20:00:00Z') };

describe('targetFigures', () => {
  it("gives the night's highest point and the target search's score and field fit", () => {
    const f = targetFigures(M31, STRASBOURG, REFRACTOR, { minAltDeg: 30 });
    const night = twilightWindow(STRASBOURG.date, STRASBOURG.lat, STRASBOURG.lon)!;
    const peak = maxAltDuringWindow(M31.ra, M31.dec, 48.58, 7.75, night.start, night.end, 10);
    const scores = scoreDso(M31, REFRACTOR, peak.maxAltDeg, { minAltDeg: 30 });
    expect(f.bestTimeUtc).toEqual(peak.atDate);
    expect(f.maxAltDeg).toBe(peak.maxAltDeg);
    expect(f.scorePct).toBe(Math.round(scores.score * 100));
    expect(f.fovFitPct).toBe(Math.round(scores.fovFitScore * 100));
  });

  it('gives the field fit alone without a night, and nothing scored without a setup', () => {
    expect(targetFigures(M31, null, REFRACTOR)).toEqual({
      bestTimeUtc: null,
      maxAltDeg: null,
      scorePct: null,
      fovFitPct: Math.round(scoreDso(M31, REFRACTOR, 0).fovFitScore * 100),
    });
    const noSetup = targetFigures(M31, STRASBOURG, null);
    expect(noSetup.bestTimeUtc).toBeInstanceOf(Date);
    expect(noSetup.scorePct).toBeNull();
    expect(noSetup.fovFitPct).toBeNull();
  });

  it('counts an oversized object as fitting when the search includes them', () => {
    const huge = { ...M31, majAxis: 2000 } as DSO;
    expect(targetFigures(huge, null, REFRACTOR).fovFitPct).toBeLessThan(100);
    expect(targetFigures(huge, null, REFRACTOR, { includeOversized: true }).fovFitPct).toBe(100);
  });
});
