import { describe, it, expect } from 'vitest';
import {
  placeLabel,
  overlaps,
  rectCenterX,
  type Rect,
  type Size,
  type Clearance,
} from '../../src/dso-label-placement';

// Ported from the sibling Android app's `ui/LabelPlacementTest.kt`
// (`C:\Workspace\TiffViewer`) — same cases, same reasoning.

const SIZE: Size = { width: 60, height: 14 };
const GAP = 3;

function place(
  anchor: { x: number; y: number },
  occupied: Rect[],
  clearance: number | Clearance = 12,
): Rect {
  const c = typeof clearance === 'number' ? { x: clearance, y: clearance } : clearance;
  return placeLabel(anchor, c, SIZE, GAP, occupied);
}

describe('placeLabel', () => {
  it('a label with nothing in the way sits centred under its object', () => {
    const box = place({ x: 100, y: 100 }, []);
    expect(rectCenterX(box)).toBeCloseTo(100, 2);
    expect(box.top).toBeGreaterThanOrEqual(100 + 12);
  });

  it('a second label on the same spot moves out of the way', () => {
    const first = place({ x: 100, y: 100 }, []);
    const second = place({ x: 100, y: 100 }, [first]);
    expect(overlaps(first, second)).toBe(false);
  });

  it('a whole cap of labels on one spot all end up separate', () => {
    // The degenerate case at the real limit: many objects projected onto one pixel.
    // Nothing may overlap anything, however far they have to be pushed.
    const placed: Rect[] = [];
    for (let i = 0; i < 15; i++) {
      placed.push(place({ x: 200, y: 200 }, placed));
    }
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        expect(overlaps(placed[i], placed[j])).toBe(false);
      }
    }
  });

  it('the first label placed keeps the preferred position', () => {
    // Callers place in the order they care about — brightest/largest first — so the
    // most important name must not be the one that gets shoved.
    const important = place({ x: 50, y: 50 }, []);
    const lesser = place({ x: 52, y: 51 }, [important]);
    expect(rectCenterX(important)).toBeCloseTo(50, 2);
    expect(overlaps(important, lesser)).toBe(false);
  });

  it('a near miss is left alone', () => {
    // Only actual collisions cost a label its preferred spot.
    const far: Rect = { left: 900, top: 900, right: 960, bottom: 914 };
    const box = place({ x: 100, y: 100 }, [far]);
    expect(rectCenterX(box)).toBeCloseTo(100, 2);
  });

  it('a big outline gets its label pushed clear of it', () => {
    // Clearance is the object's own half-major-axis: a large galaxy must not have its
    // name written across the middle of it.
    const small = place({ x: 100, y: 100 }, [], 12);
    const large = place({ x: 100, y: 100 }, [], 200);
    expect(large.top).toBeGreaterThan(small.top);
    expect(large.top).toBeGreaterThanOrEqual(100 + 200);
  });

  it('a wide, short ellipse gets its label placed close under it, not pushed down by its long axis', () => {
    // A wide, flat ellipse (e.g. an edge-on galaxy): clearance.x is large, clearance.y
    // is small. The label goes below the object, so its distance from the anchor
    // must track clearance.y, not clearance.x — a single isotropic clearance would
    // wrongly push it far below.
    const wide = place({ x: 100, y: 100 }, [], { x: 200, y: 10 });
    expect(wide.top).toBeCloseTo(100 + 10 + GAP, 2);
  });

  it('a side placement offsets by clearance.x, not clearance.y', () => {
    // Occupy the below/above candidates in turn (via real placeLabel output, so the
    // rects are exact) so placement falls through to a side candidate — its
    // horizontal offset from the anchor must be clearance.x + gap.
    const clearance: Clearance = { x: 200, y: 10 };
    const anchor = { x: 100, y: 100 };
    const below = place(anchor, [], clearance);
    const above = place(anchor, [below], clearance);
    const box = place(anchor, [below, above], clearance);
    expect(box.left).toBeCloseTo(anchor.x + clearance.x + GAP, 2);
  });

  it('labels give way to a fixed obstacle such as the compass', () => {
    const compass: Rect = { left: 280, top: 80, right: 340, bottom: 140 };
    const box = place({ x: 300, y: 100 }, [compass]);
    expect(overlaps(box, compass)).toBe(false);
  });

  it('placement is deterministic', () => {
    // Same inputs, same answer: a redraw must not reshuffle labels.
    const occupied: Rect[] = [
      { left: 70, top: 103, right: 130, bottom: 117 },
      { left: 30, top: 73, right: 90, bottom: 87 },
    ];
    const first = place({ x: 100, y: 100 }, occupied);
    const second = place({ x: 100, y: 100 }, occupied);
    expect(second).toEqual(first);
  });
});
