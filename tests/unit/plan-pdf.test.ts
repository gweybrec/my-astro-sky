import { describe, it, expect } from 'vitest';
import { buildPlanPdfTargets } from '@myastrosky/core/targets/plan-pdf';
import type { PlanNight } from '@myastrosky/core/targets/plan';
import type { DSO } from '@myastrosky/core/types';

const dso = (id: string, ra: number, dec: number): DSO =>
  ({
    id,
    ra,
    dec,
    type: 'EN',
    majAxis: 60,
    minAxis: 40,
    pa: 0,
    mag: 5,
    displayName: id,
    catalogs: [id],
    emissionLines: null,
    constellation: null,
    rating: null,
    difficulty: null,
    containerId: null,
    priority: 0,
  }) as DSO;

const entry = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  dsoId: null,
  position: 0,
  paDeg: null,
  ra: null,
  dec: null,
  notes: null,
  mosaicId: null,
  mosaicWDeg: null,
  mosaicHDeg: null,
  observationWindows: [],
  ...over,
});

const win = { start: new Date('2026-10-03T19:00:00Z'), end: new Date('2026-10-04T04:00:00Z') };
const window1 = {
  id: 'w1',
  startFrac: 0.1,
  endFrac: 0.3,
  filter: 'Ha',
  color: null,
  frameSeconds: 300,
  snap: true,
};
const info = (entryId: string, target: DSO) => ({
  entryId,
  dso: target,
  maxAltDeg: 70,
  bestTimeUtc: new Date('2026-10-03T22:00:00Z'),
  curve: [{ t: win.start, altDeg: 30 }] as never,
  moonSepDeg: 80,
});
const moon = { curve: [{ t: win.start, altDeg: 10 }] as never, phaseIndex: 3, illum: 0.6 };
const night = (over: Partial<PlanNight> = {}) => ({
  loc: { latDeg: 48.58, lonDeg: 7.75 } as PlanNight['loc'],
  win,
  moon,
  infos: [info('e1', dso('NGC7000', 314, 44)), info('e2', dso('M31', 10.7, 41.3))],
  ...over,
});
const lookups = {
  getDsoById: (id: string) => (id === 'M33' ? dso('M33', 23.5, 30.7) : undefined),
  customLabel: () => 'Position libre',
};

describe('buildPlanPdfTargets', () => {
  it("gives one page per target in the plan's order, with its observation windows and the Moon", () => {
    const plan = {
      entries: [entry('e1', { observationWindows: [window1] }), entry('e2')],
      mosaics: [],
    };
    const pages = buildPlanPdfTargets(plan, night(), { wDeg: 2, hDeg: 1.5 }, lookups);
    expect(pages.map((p) => p.dso.id)).toEqual(['NGC7000', 'M31']);
    expect(pages[0].observationWindows).toEqual([window1]);
    expect(pages[1].observationWindows).toEqual([]);
    expect(pages[0]).toMatchObject({
      nightWin: win,
      mosaic: null,
      moonPhaseIndex: 3,
      moonIllum: 0.6,
      moonSepDeg: 80,
    });
  });

  it('leaves the Moon out when the overlay is off', () => {
    const pages = buildPlanPdfTargets(
      { entries: [entry('e1'), entry('e2')], mosaics: [] },
      night({ moon: null }),
      null,
      lookups,
    );
    expect(pages[0].moonCurve).toBeUndefined();
    expect(pages[0].moonSepDeg).toBeNull();
  });

  it('adds a page per mosaic after the targets, framing its envelope and its tiles', () => {
    const mosaic = {
      id: 'm1',
      dsoId: 'M33',
      name: null,
      centerRa: 23.5,
      centerDec: 30.7,
      paDeg: 12,
      overlapPct: 10,
      cols: 2,
      rows: 1,
      position: 0,
    };
    const plan = {
      entries: [
        entry('e1'),
        entry('e2'),
        entry('t1', { mosaicId: 'm1', ra: 23, dec: 30.7 }),
        entry('t2', { mosaicId: 'm1', ra: 24, dec: 30.7 }),
      ],
      mosaics: [mosaic, { ...mosaic, id: 'm2', dsoId: null, name: 'Champ du Cygne' }],
    };
    const pages = buildPlanPdfTargets(plan, night(), { wDeg: 2, hDeg: 1.5 }, lookups);
    expect(pages.map((p) => p.dso.displayName)).toEqual([
      'NGC7000',
      'M31',
      'M33',
      'Champ du Cygne',
    ]);
    const m = pages[2].mosaic!;
    expect(m.tiles).toEqual([
      { ra: 23, dec: 30.7 },
      { ra: 24, dec: 30.7 },
    ]);
    expect(m.paDeg).toBe(12);
    // two tiles of 2° side by side with 10 % overlap: wider than one tile, as tall as one
    expect(m.wDeg).toBeGreaterThan(2);
    expect(m.hDeg).toBeCloseTo(1.5);
    expect(pages[2].curve.length).toBeGreaterThan(0);
    expect(pages[3].dso.id).toBe('custom:mosaic:m2');
  });

  it('leaves the mosaics out without a setup to size their tiles', () => {
    const plan = {
      entries: [entry('e1'), entry('e2')],
      mosaics: [
        {
          id: 'm1',
          dsoId: null,
          name: null,
          centerRa: 23.5,
          centerDec: 30.7,
          paDeg: 0,
          overlapPct: 10,
          cols: 2,
          rows: 2,
          position: 0,
        },
      ],
    };
    expect(buildPlanPdfTargets(plan, night(), null, lookups)).toHaveLength(2);
  });
});
