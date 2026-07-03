import { describe, it, expect } from 'vitest';
import { applyZoomToward } from '../../src/image-zoom';

describe('applyZoomToward', () => {
  const MIN = 0.2;
  const MAX = 6;

  it('zoom in at the current translate origin leaves tx/ty unchanged', () => {
    const state = { scale: 1, tx: 50, ty: 30 };
    const result = applyZoomToward(state, { cx: 50, cy: 30 }, 1.12, MIN, MAX);
    expect(result.scale).toBeCloseTo(1.12);
    expect(result.tx).toBeCloseTo(50);
    expect(result.ty).toBeCloseTo(30);
  });

  it('zoom in at origin (0,0) with no existing translate moves tx/ty toward zero', () => {
    const state = { scale: 1, tx: 0, ty: 0 };
    const result = applyZoomToward(state, { cx: 0, cy: 0 }, 1.12, MIN, MAX);
    expect(result.scale).toBeCloseTo(1.12);
    expect(result.tx).toBeCloseTo(0);
    expect(result.ty).toBeCloseTo(0);
  });

  it('clamps scale at maxScale and adjusts translate correctly', () => {
    const state = { scale: 5.9, tx: 10, ty: 10 };
    const result = applyZoomToward(state, { cx: 100, cy: 100 }, 1.5, MIN, MAX);
    expect(result.scale).toBe(MAX);
    // translate should still shift to zoom toward cursor
    expect(result.tx).not.toBe(state.tx);
  });

  it('clamps scale at minScale', () => {
    const state = { scale: 0.25, tx: 0, ty: 0 };
    const result = applyZoomToward(state, { cx: 50, cy: 50 }, 0.5, MIN, MAX);
    expect(result.scale).toBe(MIN);
  });

  it('point under cursor stays fixed in image space after zoom', () => {
    const state = { scale: 1, tx: 0, ty: 0 };
    const cursor = { cx: 200, cy: 150 };
    const factor = 1.12;
    const result = applyZoomToward(state, cursor, factor, MIN, MAX);

    // The point under the cursor in image space = (cursor - tx) / scale
    const imgXBefore = (cursor.cx - state.tx) / state.scale;
    const imgYBefore = (cursor.cy - state.ty) / state.scale;
    const imgXAfter = (cursor.cx - result.tx) / result.scale;
    const imgYAfter = (cursor.cy - result.ty) / result.scale;

    expect(imgXAfter).toBeCloseTo(imgXBefore, 8);
    expect(imgYAfter).toBeCloseTo(imgYBefore, 8);
  });

  it('invariant holds at arbitrary pan offset', () => {
    const state = { scale: 2, tx: -80, ty: 40 };
    const cursor = { cx: 300, cy: 200 };
    const factor = 0.9;
    const result = applyZoomToward(state, cursor, factor, MIN, MAX);

    const imgXBefore = (cursor.cx - state.tx) / state.scale;
    const imgYBefore = (cursor.cy - state.ty) / state.scale;
    const imgXAfter = (cursor.cx - result.tx) / result.scale;
    const imgYAfter = (cursor.cy - result.ty) / result.scale;

    expect(imgXAfter).toBeCloseTo(imgXBefore, 8);
    expect(imgYAfter).toBeCloseTo(imgYBefore, 8);
  });
});
