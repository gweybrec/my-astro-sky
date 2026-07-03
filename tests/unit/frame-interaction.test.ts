import { describe, expect, it, beforeEach } from 'vitest';
import {
  findMergeTarget,
  resizeRegionFromDraft,
  type ResizeDraft,
} from '../../src/frame-interaction';
import { fromCanvas, unproject, setHemisphere } from '../../src/projection';
import type { RenderableFrame } from '../../src/sky-map';
import type { ViewState } from '../../src/types';

const view: ViewState = {
  centerX: 0,
  centerY: 0,
  scale: 600,
  rotationDeg: 0,
  width: 800,
  height: 600,
};

/** A screen-anchored frame at a given viewport fraction (deterministic geometry). */
function frame(id: string, over: Partial<RenderableFrame> = {}): RenderableFrame {
  return {
    id,
    name: id,
    label: id,
    wDeg: 4,
    hDeg: 4,
    active: false,
    movable: true,
    anchorKind: 'screen',
    nx: 0.5,
    ny: 0.5,
    screenRotationDeg: 0,
    ...over,
  };
}

describe('findMergeTarget', () => {
  beforeEach(() => setHemisphere('north'));

  it('returns an overlapping frame of the same plan', () => {
    const frames = [
      frame('plan:A:1', { nx: 0.5, ny: 0.5 }),
      frame('plan:A:2', { nx: 0.5, ny: 0.5 }), // same spot → overlaps
    ];
    expect(findMergeTarget('plan:A:1', frames, view)).toBe('plan:A:2');
  });

  it('ignores frames of a different plan', () => {
    const frames = [
      frame('plan:A:1', { nx: 0.5, ny: 0.5 }),
      frame('plan:B:2', { nx: 0.5, ny: 0.5 }), // overlaps but different plan
    ];
    expect(findMergeTarget('plan:A:1', frames, view)).toBeNull();
  });

  it('ignores non-overlapping frames', () => {
    const frames = [
      frame('plan:A:1', { nx: 0.2, ny: 0.5 }),
      frame('plan:A:2', { nx: 0.8, ny: 0.5 }), // far apart
    ];
    expect(findMergeTarget('plan:A:1', frames, view)).toBeNull();
  });

  it('skips tiles, hidden frames, and the moved frame itself', () => {
    const frames = [
      frame('plan:A:1', { nx: 0.5, ny: 0.5 }),
      frame('plan:A:2', { nx: 0.5, ny: 0.5, mosaicId: 'm1' }), // a tile → skipped
      frame('plan:A:3', { nx: 0.5, ny: 0.5, visible: false }), // hidden → skipped
    ];
    expect(findMergeTarget('plan:A:1', frames, view)).toBeNull();
  });

  it('returns null when the moved id is not found', () => {
    expect(findMergeTarget('plan:A:9', [frame('plan:A:1')], view)).toBeNull();
  });
});

describe('resizeRegionFromDraft', () => {
  beforeEach(() => setHemisphere('north'));

  it('scales both axes by the same px ratio (draft half-extents vs current frame)', () => {
    const f = frame('plan:A:1', { anchorKind: 'sky', ra: 10, dec: 45, wDeg: 2, hDeg: 1, paDeg: 0 });
    const small: ResizeDraft = { cx: 400, cy: 300, halfW: 40, halfH: 20, rotDeg: 0 };
    const big: ResizeDraft = { cx: 400, cy: 300, halfW: 80, halfH: 40, rotDeg: 0 };
    const rSmall = resizeRegionFromDraft(f, small, view, fromCanvas, unproject);
    const rBig = resizeRegionFromDraft(f, big, view, fromCanvas, unproject);
    // Doubling both draft half-extents doubles both angular dimensions.
    expect(rBig.wDeg).toBeCloseTo(rSmall.wDeg * 2, 6);
    expect(rBig.hDeg).toBeCloseTo(rSmall.hDeg * 2, 6);
    // Both axes share the same scale ratio (aspect preserved when draft aspect matches).
    expect(rSmall.wDeg / f.wDeg).toBeCloseTo(rSmall.hDeg / f.hDeg, 6);
    expect(Number.isFinite(rSmall.paDeg)).toBe(true);
  });

  it('produces a centre at the draft centroid (round-trips through the projection)', () => {
    const f = frame('plan:A:1', { anchorKind: 'sky', ra: 10, dec: 45, wDeg: 2, hDeg: 2, paDeg: 0 });
    const draft: ResizeDraft = { cx: 420, cy: 280, halfW: 60, halfH: 60, rotDeg: 0 };
    const region = resizeRegionFromDraft(f, draft, view, fromCanvas, unproject);
    const proj = fromCanvas(420, 280, view);
    const expected = unproject(proj.x, proj.y);
    expect(region.centerRa).toBeCloseTo(expected.ra, 6);
    expect(region.centerDec).toBeCloseTo(expected.dec, 6);
  });
});
