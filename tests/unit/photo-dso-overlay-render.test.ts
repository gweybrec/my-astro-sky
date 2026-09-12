import { describe, it, expect } from 'vitest';
import {
  computePhotoDsoOverlayLayout,
  withAlpha,
  ellipseBoundExtent,
  ellipseLabelClearance,
} from '../../src/photo-dso-overlay-render';
import { overlaps } from '../../src/dso-label-placement';
import type { DSO } from '../../src/types';
import type { PhotoDsoPlacement } from '../../src/dso-catalog';

function makeDso(id: string, extra?: Partial<DSO>): DSO {
  return {
    id,
    ra: 0,
    dec: 0,
    type: 'Gx',
    majAxis: null,
    minAxis: null,
    pa: 0,
    mag: null,
    displayName: null,
    catalogs: [id],
    emissionLines: null,
    constellation: null,
    rating: null,
    difficulty: null,
    containerId: null,
    priority: 0,
    catalog: null,
    ...extra,
  } as DSO;
}

function placement(
  dso: DSO,
  x: number,
  y: number,
  extra?: Partial<PhotoDsoPlacement>,
): PhotoDsoPlacement {
  return { dso, displayId: dso.id, x, y, majorPx: 20, minorPx: 20, angleDeg: 0, ...extra };
}

// A fixed-width stub measurer keeps the geometry predictable across tests.
const measure = (text: string) => text.length * 6;
// Generous viewport so clamping never interferes with the geometry-focused tests.
const BIG_VIEWPORT = { left: 0, top: 0, right: 2000, bottom: 2000 };

describe('computePhotoDsoOverlayLayout', () => {
  it('scales screen position and radii by dispScale', () => {
    const dso = makeDso('M1', { majAxis: 6, minAxis: 4 });
    const items = computePhotoDsoOverlayLayout(
      [placement(dso, 100, 200, { majorPx: 60, minorPx: 40 })],
      0.5,
      measure,
      BIG_VIEWPORT,
    );
    expect(items).toHaveLength(1);
    expect(items[0].screenX).toBeCloseTo(50);
    expect(items[0].screenY).toBeCloseTo(100);
    expect(items[0].rx).toBeCloseTo(15); // 60/2 * 0.5
    expect(items[0].ry).toBeCloseTo(10); // 40/2 * 0.5
  });

  it('clamps radii to a minimum so a point-like DSO still gets a visible marker', () => {
    const dso = makeDso('TESTOBJ');
    const items = computePhotoDsoOverlayLayout(
      [placement(dso, 0, 0, { majorPx: 0, minorPx: 0 })],
      1,
      measure,
      BIG_VIEWPORT,
    );
    expect(items[0].rx).toBeGreaterThan(0);
    expect(items[0].ry).toBeGreaterThan(0);
  });

  it('processes brighter (lower mag) DSOs first, keeping their preferred label spot', () => {
    const bright = makeDso('Bright', { mag: 4 });
    const dim = makeDso('Dim', { mag: 12 });
    // Both projected to the same point, so without ordering either could "win".
    const items = computePhotoDsoOverlayLayout(
      [placement(dim, 100, 100), placement(bright, 100, 100)],
      1,
      measure,
      BIG_VIEWPORT,
    );
    expect(items[0].dso.id).toBe('Bright');
    expect(items[1].dso.id).toBe('Dim');
    // The label boxes must never overlap once laid out.
    expect(overlaps(items[0].labelBox, items[1].labelBox)).toBe(false);
  });

  it('falls back to larger majAxis first when magnitude is unknown for both', () => {
    const small = makeDso('Small', { majAxis: 2 });
    const large = makeDso('Large', { majAxis: 40 });
    const items = computePhotoDsoOverlayLayout(
      [placement(small, 0, 0), placement(large, 0, 0)],
      1,
      measure,
      BIG_VIEWPORT,
    );
    expect(items[0].dso.id).toBe('Large');
  });

  it('produces no overlapping label boxes for a dense cluster', () => {
    const dsos = Array.from({ length: 10 }, (_, i) => makeDso(`D${i}`, { mag: i }));
    const items = computePhotoDsoOverlayLayout(
      dsos.map((d) => placement(d, 300, 300)),
      1,
      measure,
      BIG_VIEWPORT,
    );
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        expect(overlaps(items[i].labelBox, items[j].labelBox)).toBe(false);
      }
    }
  });

  it('clamps a label that would otherwise land below the viewport back into view', () => {
    // A DSO near the bottom edge: its default "below the object" label placement
    // would land past the viewport's bottom edge, where the canvas would silently
    // clip it — the label must be visible instead.
    const dso = makeDso('EdgeObj', { mag: 5 });
    const viewport = { left: 0, top: 0, right: 400, bottom: 300 };
    const items = computePhotoDsoOverlayLayout(
      [placement(dso, 200, 295, { majorPx: 20, minorPx: 20 })],
      1,
      measure,
      viewport,
    );
    expect(items[0].labelBox.bottom).toBeLessThanOrEqual(viewport.bottom);
    expect(items[0].labelBox.top).toBeGreaterThanOrEqual(viewport.top);
  });

  it('clamps a label that would land past the right edge back into view', () => {
    const dso = makeDso('RightEdgeObj', { mag: 5 });
    const viewport = { left: 0, top: 0, right: 200, bottom: 400 };
    const items = computePhotoDsoOverlayLayout(
      [placement(dso, 195, 200, { majorPx: 20, minorPx: 20 })],
      1,
      measure,
      viewport,
    );
    expect(items[0].labelBox.right).toBeLessThanOrEqual(viewport.right);
    expect(items[0].labelBox.left).toBeGreaterThanOrEqual(viewport.left);
  });

  it('clamps a label into the visible sub-window when the viewport does not start at the origin', () => {
    // Mirrors a zoomed/panned photo: the image's own bounds extend well beyond the
    // container that clips it, so the caller passes a viewport offset from (0,0).
    // A label must land inside that offset window, not merely inside [0, width].
    const dso = makeDso('PannedObj', { mag: 5 });
    const viewport = { left: 500, top: 500, right: 700, bottom: 650 };
    const items = computePhotoDsoOverlayLayout(
      [placement(dso, 690, 645, { majorPx: 20, minorPx: 20 })],
      1,
      measure,
      viewport,
    );
    const box = items[0].labelBox;
    expect(box.left).toBeGreaterThanOrEqual(viewport.left);
    expect(box.right).toBeLessThanOrEqual(viewport.right);
    expect(box.top).toBeGreaterThanOrEqual(viewport.top);
    expect(box.bottom).toBeLessThanOrEqual(viewport.bottom);
  });
});

describe('withAlpha', () => {
  it('replaces the alpha channel of an rgba color', () => {
    expect(withAlpha('rgba(220, 180, 100, 0.6)', 0.95)).toBe('rgba(220, 180, 100, 0.95)');
  });

  it('returns the input unchanged when it is not an rgba(...) string', () => {
    expect(withAlpha('currentColor', 0.95)).toBe('currentColor');
  });
});

describe('ellipseBoundExtent', () => {
  it('at halfSpan=0, matches the single-point boundary radius for an unrotated ellipse', () => {
    // x in [-0,0] only admits the two points at x=0, whose y is ±ry.
    expect(ellipseBoundExtent(40, 10, 0, 'y', 0)).toBeCloseTo(10);
    expect(ellipseBoundExtent(40, 10, 0, 'x', 0)).toBeCloseTo(40);
  });

  it('is symmetric for a circle regardless of angle or span', () => {
    expect(ellipseBoundExtent(20, 20, 37, 'y', 5)).toBeCloseTo(20, 0);
  });

  it('grows monotonically as the span widens, up to the full bounding-box half-extent', () => {
    const rx = 40,
      ry = 10,
      angle = 35;
    const small = ellipseBoundExtent(rx, ry, angle, 'y', 5);
    const large = ellipseBoundExtent(rx, ry, angle, 'y', 30);
    expect(large).toBeGreaterThan(small);
    // At a span covering the ellipse's full horizontal extent, the answer converges
    // to the ordinary bounding-box half-height.
    const rad = (angle * Math.PI) / 180;
    const bboxHalfHeight = Math.sqrt((rx * Math.sin(rad)) ** 2 + (ry * Math.cos(rad)) ** 2);
    const full = ellipseBoundExtent(rx, ry, angle, 'y', rx + ry);
    expect(full).toBeCloseTo(bboxHalfHeight, 0);
  });

  it("reaches further than the centre-line point for a real label's footprint — the NGC4725 case", () => {
    // A tilted, elongated galaxy and a label half as wide as its major axis: the
    // point straight below centre underestimates how far down the tilted outline
    // reaches under the label's far end, which is what let a label's last character
    // clip the outline.
    const rx = 60,
      ry = 20,
      angle = 30;
    const halfWidth = 25;
    const centreLine = ellipseBoundExtent(rx, ry, angle, 'y', 0);
    const footprint = ellipseBoundExtent(rx, ry, angle, 'y', halfWidth);
    expect(footprint).toBeGreaterThan(centreLine);
  });

  it('finds a span narrower than the sample spacing via interpolation, not raw sampling', () => {
    // A large ellipse with a tiny span: at the fixed sample count, no raw sample
    // point is guaranteed to land inside so narrow a span (this is exactly what
    // silently returned 0 before boundary-crossing interpolation was added — a
    // regression that would have put a label right on top of its object).
    const e = ellipseBoundExtent(2000, 500, 17, 'y', 0.01);
    expect(e).toBeGreaterThan(0);
  });
});

describe('ellipseLabelClearance', () => {
  it('uses the label half-width for vertical clearance and half-height for horizontal', () => {
    const rx = 60,
      ry = 20,
      angle = 30;
    const wide = ellipseLabelClearance(rx, ry, angle, { width: 80, height: 13 });
    const narrow = ellipseLabelClearance(rx, ry, angle, { width: 10, height: 13 });
    // A wider label's footprint reaches further round the tilted ellipse, so it
    // needs at least as much vertical clearance as a narrower one.
    expect(wide.y).toBeGreaterThanOrEqual(narrow.y);
  });
});
