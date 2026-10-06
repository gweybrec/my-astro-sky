/**
 * Tests for src/poi-pins.ts (positioned-POI pins: placement on a photo, the
 * 8-ray starburst drawing, the photo-overlay label layout) and the sky map's pin
 * pass, `renderPoiPins` in src/sky-frame-render.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  hasPosition,
  poiPinsInImage,
  drawPoiPin,
  computePoiPinLayout,
  renderPoiPinOverlay,
  PHOTO_PIN_RADIUS_PX,
} from '../../src/poi-pins';
import { renderPoiPins } from '../../src/sky-frame-render';
import { fitPhotoAffine } from '@myastrosky/core/photo-placement';
import { project, toCanvas } from '@myastrosky/core/projection';
import type { PointOfInterest } from '@myastrosky/core/types';
import type { SkyScene } from '../../src/sky-scene';

function mockCtx() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    measureText: vi.fn((s: string) => ({ width: s.length * 6 })),
    lineCap: '',
    lineWidth: 0,
    strokeStyle: '',
    fillStyle: '',
    font: '',
    textBaseline: '',
  };
}

// 100×100 photo, 0.01°/px around (RA 10°, Dec 40°), north up / east left.
const PTS = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];
const sky = (x: number, y: number) => ({
  ra: 10 - ((x - 50) * 0.01) / Math.cos((40 * Math.PI) / 180),
  dec: 40 - (y - 50) * 0.01,
});
const PHOTO_TO_PROJ = fitPhotoAffine(
  PTS,
  PTS.map((p) => {
    const s = sky(p.x, p.y);
    return project(s.ra, s.dec);
  }),
);

describe('hasPosition()', () => {
  it('is true only with finite ra and dec', () => {
    expect(hasPosition({ name: 'a', categoryId: 'c', ra: 1, dec: 2 })).toBe(true);
    expect(hasPosition({ name: 'a', categoryId: 'c' })).toBe(false);
    expect(hasPosition({ name: 'a', categoryId: 'c', ra: NaN, dec: 2 })).toBe(false);
  });
});

describe('poiPinsInImage()', () => {
  it('places positioned POIs inside the photo and skips the rest', () => {
    const inside = sky(25, 75);
    const pois: PointOfInterest[] = [
      { name: 'SN in', categoryId: 'cat-supernova', ra: inside.ra, dec: inside.dec },
      { name: 'SN out', categoryId: 'cat-supernova', ra: 30, dec: 40 },
      { name: 'Comet', categoryId: 'cat-comet' },
    ];
    const pins = poiPinsInImage(pois, PHOTO_TO_PROJ, 100, 100);
    expect(pins).toHaveLength(1);
    expect(pins[0].poi.name).toBe('SN in');
    expect(pins[0].x).toBeCloseTo(25, 0);
    expect(pins[0].y).toBeCloseTo(75, 0);
  });
});

describe('drawPoiPin()', () => {
  it('draws 8 rays (no centre dot), halo then colour', () => {
    const ctx = mockCtx();
    drawPoiPin(ctx as unknown as CanvasRenderingContext2D, 50, 50, 10, '#ff5a5a');
    expect(ctx.moveTo).toHaveBeenCalledTimes(8);
    expect(ctx.lineTo).toHaveBeenCalledTimes(8);
    expect(ctx.stroke).toHaveBeenCalledTimes(2);
    expect(ctx.strokeStyle).toBe('#ff5a5a');
    // Rays start well away from the centre: the object itself stays visible.
    for (const [x, y] of ctx.moveTo.mock.calls) {
      expect(Math.hypot(x - 50, y - 50)).toBeGreaterThan(6);
    }
  });
});

describe('computePoiPinLayout()', () => {
  const viewport = { left: 0, top: 0, right: 400, bottom: 300 };
  const pin = {
    poi: { name: 'SN 2026aaiv', categoryId: 'cat-supernova', ra: 1, dec: 1 },
    x: 100,
    y: 100,
  };

  it('scales the pin to screen space and labels it clear of the rays', () => {
    const [item] = computePoiPinLayout(
      [pin],
      0.5,
      () => '#f00',
      (s) => s.length * 6,
      viewport,
    );
    expect(item.screenX).toBe(50);
    expect(item.screenY).toBe(50);
    expect(item.color).toBe('#f00');
    const box = item.labelBox;
    const clear =
      box.left >= 50 + PHOTO_PIN_RADIUS_PX ||
      box.right <= 50 - PHOTO_PIN_RADIUS_PX ||
      box.top >= 50 + PHOTO_PIN_RADIUS_PX ||
      box.bottom <= 50 - PHOTO_PIN_RADIUS_PX;
    expect(clear).toBe(true);
  });

  it('avoids boxes already taken by DSO labels', () => {
    const [free] = computePoiPinLayout(
      [pin],
      1,
      () => '#f00',
      (s) => s.length * 6,
      viewport,
    );
    const [moved] = computePoiPinLayout(
      [pin],
      1,
      () => '#f00',
      (s) => s.length * 6,
      viewport,
      [free.labelBox],
    );
    expect(moved.labelBox).not.toEqual(free.labelBox);
  });

  it('draws pins then labels', () => {
    const ctx = mockCtx();
    const items = computePoiPinLayout(
      [pin],
      1,
      () => '#f00',
      (s) => s.length * 6,
      viewport,
    );
    renderPoiPinOverlay(ctx as unknown as CanvasRenderingContext2D, items, 'bold 11px sans-serif');
    expect(ctx.moveTo).toHaveBeenCalledTimes(8);
    expect(ctx.fillText).toHaveBeenCalledWith(
      'SN 2026aaiv',
      items[0].labelBox.left,
      items[0].labelBox.top,
    );
  });
});

describe('renderPoiPins() (sky map)', () => {
  const view = { centerX: 0, centerY: 0, scale: 500, rotationDeg: 0, width: 800, height: 600 };

  function scene(ctx: ReturnType<typeof mockCtx>, pins: SkyScene['poiPins']): SkyScene {
    return { ctx, view, poiPins: pins } as unknown as SkyScene;
  }

  it('draws each on-screen pin with its label at the projected position', () => {
    // Pick a sky point that projects inside the 800×600 viewport.
    const target = { ra: 0, dec: 89 };
    const p = project(target.ra, target.dec);
    const c = toCanvas(p.x, p.y, view as never);
    expect(c.x).toBeGreaterThan(0);
    expect(c.x).toBeLessThan(800);

    const ctx = mockCtx();
    renderPoiPins(scene(ctx, [{ ...target, label: 'SN X', color: '#ff5a5a' }]));
    expect(ctx.moveTo).toHaveBeenCalledTimes(8);
    const [label, lx, ly] = ctx.fillText.mock.calls[0];
    expect(label).toBe('SN X');
    expect(lx).toBeGreaterThan(c.x);
    expect(ly).toBeCloseTo(c.y, 5);
  });

  it('skips pins far outside the viewport', () => {
    const ctx = mockCtx();
    renderPoiPins(scene(ctx, [{ ra: 0, dec: -60, label: 'far', color: '#fff' }]));
    expect(ctx.fillText).not.toHaveBeenCalled();
  });
});
