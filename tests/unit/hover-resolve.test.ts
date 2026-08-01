import { describe, expect, it } from 'vitest';

import { resolveHover, type HoverAnchor, type HoverResolveInput } from '../../src/hover-resolve';

/**
 * Hover target resolution: which tooltip (if any) the cursor should show, and when a
 * tooltip survives the sky drifting out from under a stationary cursor in date mode.
 * Distances are in projection units.
 */

const GRACE = 6;

function input(overrides: Partial<HoverResolveInput> = {}): HoverResolveInput {
  return {
    summit: null,
    star: null,
    dso: null,
    mx: 100,
    my: 100,
    simMs: 1_000,
    anchor: null,
    gracePx: GRACE,
    ...overrides,
  };
}

const near = (dist: number) => ({ rendered: true, dist });
const gated = (dist: number) => ({ rendered: false, dist });

describe('resolveHover', () => {
  describe('winner selection', () => {
    it('dismisses when nothing is under the cursor', () => {
      expect(resolveHover(input())).toEqual({ kind: 'dismiss' });
    });

    it('shows the only rendered candidate', () => {
      expect(resolveHover(input({ star: near(0.5) })).kind).toBe('star');
      expect(resolveHover(input({ dso: near(0.5) })).kind).toBe('dso');
      expect(resolveHover(input({ summit: near(0.5) })).kind).toBe('summit');
    });

    it('picks the nearer of a star and a DSO', () => {
      expect(resolveHover(input({ star: near(0.2), dso: near(0.9) })).kind).toBe('star');
      expect(resolveHover(input({ star: near(0.9), dso: near(0.2) })).kind).toBe('dso');
    });

    it('gives an exact star/DSO tie to the DSO', () => {
      expect(resolveHover(input({ star: near(0.4), dso: near(0.4) })).kind).toBe('dso');
    });

    it('lets a summit win ties against both star and DSO', () => {
      const r = resolveHover(input({ summit: near(0.4), star: near(0.4), dso: near(0.4) }));
      expect(r.kind).toBe('summit');
    });

    it('lets a genuinely closer star beat a summit', () => {
      expect(resolveHover(input({ summit: near(0.4), star: near(0.1) })).kind).toBe('star');
    });

    it('ignores a star that is nearest but gated out of the render pass', () => {
      // The index found it, but the density gate is not drawing it — no tooltip for
      // something the user cannot see; the rendered DSO behind it wins instead.
      const r = resolveHover(input({ star: gated(0.05), dso: near(0.8) }));
      expect(r.kind).toBe('dso');
    });

    it('ignores a gated DSO the same way', () => {
      expect(resolveHover(input({ star: near(0.8), dso: gated(0.05) })).kind).toBe('star');
    });

    it('dismisses when every candidate is gated out', () => {
      expect(resolveHover(input({ star: gated(0.1), dso: gated(0.1) }))).toEqual({
        kind: 'dismiss',
      });
    });

    it('shows a summit even when the only other candidates are gated', () => {
      // Gated candidates count as infinitely far, so the summit wins on distance.
      const r = resolveHover(input({ summit: near(9), star: gated(0.1) }));
      expect(r.kind).toBe('summit');
    });

    it('anchors the result at the current cursor position and clock', () => {
      const r = resolveHover(input({ star: near(0.5), mx: 42, my: 77, simMs: 5_000 }));
      expect(r).toEqual({ kind: 'star', anchor: { mx: 42, my: 77, simMs: 5_000 } });
    });
  });

  describe('sky-drift grace', () => {
    const anchor: HoverAnchor = { mx: 100, my: 100, simMs: 1_000 };

    it('keeps the tooltip when the sky advanced and the cursor barely moved', () => {
      const r = resolveHover(input({ anchor, simMs: 2_000, mx: 103, my: 100 }));
      expect(r.kind).toBe('keep');
    });

    it('dismisses when the clock has not advanced, however still the cursor', () => {
      // Not date mode / clock paused: empty sky under the cursor really means empty.
      const r = resolveHover(input({ anchor, simMs: 1_000, mx: 100, my: 100 }));
      expect(r).toEqual({ kind: 'dismiss' });
    });

    it('dismisses on a deliberate move even while the clock runs', () => {
      const r = resolveHover(input({ anchor, simMs: 2_000, mx: 140, my: 100 }));
      expect(r).toEqual({ kind: 'dismiss' });
    });

    it('treats a move of exactly the grace radius as still', () => {
      const r = resolveHover(input({ anchor, simMs: 2_000, mx: 100 + GRACE, my: 100 }));
      expect(r.kind).toBe('keep');
    });

    it('dismisses just past the grace radius', () => {
      const r = resolveHover(input({ anchor, simMs: 2_000, mx: 100 + GRACE + 0.01, my: 100 }));
      expect(r).toEqual({ kind: 'dismiss' });
    });

    it('dismisses when there is no anchor (no tooltip was showing)', () => {
      expect(resolveHover(input({ anchor: null, simMs: 2_000 }))).toEqual({ kind: 'dismiss' });
    });

    it('refreshes the anchor each frame so the tolerance is per-frame, not cumulative', () => {
      // Every real mouse has tremor. If the anchor stayed pinned to the original find,
      // the grace radius would be a budget spent across the whole hold and a long hold
      // during a fast clock would eventually drop the tooltip. Walking 4px per frame
      // (under the 6px grace) must hold indefinitely.
      let a: HoverAnchor = { mx: 100, my: 100, simMs: 1_000 };
      for (let i = 1; i <= 50; i++) {
        const r = resolveHover(input({ anchor: a, simMs: 1_000 + i * 1_000, mx: 100 + i * 4 }));
        expect(r.kind).toBe('keep');
        a = (r as { anchor: HoverAnchor }).anchor;
      }
      // The cursor has travelled 200px in total — far past the grace radius — yet held.
      expect(a.mx).toBe(300);
    });
  });
});
