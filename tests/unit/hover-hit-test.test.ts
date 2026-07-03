import { describe, expect, it, beforeEach } from 'vitest';
import { pickDsoAtCursor } from '../../src/hover-hit-test';
import { project, toCanvas, setHemisphere } from '../../src/projection';
import type { DSO, ViewState } from '../../src/types';

const view: ViewState = {
  centerX: 0,
  centerY: 0,
  scale: 600,
  rotationDeg: 0,
  width: 800,
  height: 600,
};

function dso(id: string, ra: number, dec: number, majAxis: number): DSO {
  return { id, ra, dec, mag: 8, majAxis, minAxis: majAxis, pa: 0, type: 'Gx' } as unknown as DSO;
}

/** Canvas position of a DSO under `view`. */
function canvasOf(d: DSO): { x: number; y: number } {
  const p = project(d.ra, d.dec);
  return toCanvas(p.x, p.y, view);
}

describe('pickDsoAtCursor', () => {
  beforeEach(() => setHemisphere('north'));

  it('returns null when there are no candidates', () => {
    expect(pickDsoAtCursor([], 400, 300, view)).toBeNull();
  });

  it('returns a DSO whose ellipse contains the cursor', () => {
    const d = dso('A', 20, 60, 30);
    const c = canvasOf(d);
    expect(pickDsoAtCursor([d], c.x, c.y, view)?.id).toBe('A');
  });

  it('prefers the smallest containing DSO when several overlap', () => {
    const big = dso('big', 20, 60, 120);
    const small = dso('small', 20, 60, 8); // same centre, tiny
    const c = canvasOf(big);
    // Cursor at the shared centre is inside both; the compact one wins.
    expect(pickDsoAtCursor([big, small], c.x, c.y, view)?.id).toBe('small');
  });

  it('returns null when the cursor is far from every candidate', () => {
    const d = dso('A', 20, 60, 5);
    const c = canvasOf(d);
    expect(pickDsoAtCursor([d], c.x + 300, c.y + 300, view)).toBeNull();
  });
});
