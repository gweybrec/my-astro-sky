import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { trackAnchoredPosition, attachAnchoredPanel } from '../../src/popup-utils';

/** Build an anchor element whose getBoundingClientRect returns the given box. */
function makeAnchor(box: Partial<DOMRect>): HTMLElement {
  const el = document.createElement('button');
  const rect = {
    top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0,
    ...box,
  } as DOMRect;
  el.getBoundingClientRect = () => rect;
  return el;
}

/** Build a panel with stubbed offset dimensions (happy-dom reports 0 otherwise). */
function makePanel(w: number, h: number): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'offsetWidth', { value: w, configurable: true });
  Object.defineProperty(el, 'offsetHeight', { value: h, configurable: true });
  document.body.appendChild(el);
  return el;
}

describe('trackAnchoredPosition', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('places the panel below the anchor when there is room', () => {
    const anchor = makeAnchor({ top: 100, bottom: 120, left: 200, right: 300 });
    const panel = makePanel(150, 200);
    const cleanup = trackAnchoredPosition(panel, anchor);
    expect(panel.style.position).toBe('fixed');
    expect(panel.style.top).toBe('124px'); // bottom (120) + gap (4)
    cleanup();
  });

  it('flips above the anchor when there is no room below', () => {
    // Anchor near the bottom: below + h would overflow, and rect.top >= h, so go above.
    const anchor = makeAnchor({ top: 700, bottom: 720, left: 200, right: 300 });
    const panel = makePanel(150, 300);
    const cleanup = trackAnchoredPosition(panel, anchor);
    // above => rect.top - gap - h = 700 - 4 - 300 = 396
    expect(panel.style.top).toBe('396px');
    cleanup();
  });

  it('left-aligns to the anchor by default', () => {
    const anchor = makeAnchor({ top: 100, bottom: 120, left: 200, right: 300 });
    const panel = makePanel(150, 100);
    const cleanup = trackAnchoredPosition(panel, anchor);
    expect(panel.style.left).toBe('200px');
    cleanup();
  });

  it('right-aligns the panel edge to the anchor edge when alignRight is set', () => {
    const anchor = makeAnchor({ top: 100, bottom: 120, left: 200, right: 300 });
    const panel = makePanel(150, 100);
    const cleanup = trackAnchoredPosition(panel, anchor, { alignRight: true });
    // right (300) - w (150) = 150
    expect(panel.style.left).toBe('150px');
    cleanup();
  });

  it('clamps left within [8, innerWidth - w - 8]', () => {
    // Anchor at the far right edge; left-align would push the panel off-screen.
    const anchor = makeAnchor({ top: 100, bottom: 120, left: 980, right: 1000 });
    const panel = makePanel(200, 100);
    const cleanup = trackAnchoredPosition(panel, anchor);
    // raw left = 980, max allowed = 1000 - 200 - 8 = 792
    expect(panel.style.left).toBe('792px');
    cleanup();

    // Anchor near the left edge; clamp to the 8px minimum.
    const anchor2 = makeAnchor({ top: 100, bottom: 120, left: -50, right: 50 });
    const panel2 = makePanel(200, 100);
    const cleanup2 = trackAnchoredPosition(panel2, anchor2);
    expect(panel2.style.left).toBe('8px');
    cleanup2();
  });

  it('calls onAnchorOutOfView when the anchor is off-screen', () => {
    const anchor = makeAnchor({ top: 900, bottom: 920, left: 200, right: 300 }); // below viewport
    const panel = makePanel(150, 100);
    const onAnchorOutOfView = vi.fn();
    const cleanup = trackAnchoredPosition(panel, anchor, { onAnchorOutOfView });
    expect(onAnchorOutOfView).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('cleanup removes the scroll and resize listeners', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const anchor = makeAnchor({ top: 100, bottom: 120, left: 200, right: 300 });
    const panel = makePanel(150, 100);
    const cleanup = trackAnchoredPosition(panel, anchor);
    cleanup();
    expect(removeSpy).toHaveBeenCalledWith('scroll', expect.any(Function), true);
    expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function));
  });

  it('attachAnchoredPanel uses native CSS anchoring when supported', () => {
    const supports = vi.fn().mockReturnValue(true);
    vi.stubGlobal('CSS', { supports });
    const anchor = makeAnchor({ top: 100, bottom: 120, left: 200, right: 300 });
    const panel = makePanel(150, 100);
    const cleanup = attachAnchoredPanel(panel, anchor, { alignRight: true });
    // The anchor gets a generated anchor-name and the panel binds to it natively.
    // (happy-dom drops the `anchor()` inset values as invalid lengths, so we assert
    // on the custom-ident binding it does retain rather than top/right.)
    const name = anchor.style.getPropertyValue('anchor-name');
    expect(name).toMatch(/^--anchored-\d+$/);
    expect(panel.style.getPropertyValue('position-anchor')).toBe(name);
    expect(panel.style.getPropertyValue('position-try-fallbacks')).toContain('flip-block');
    // No JS scroll listeners are attached on the native path.
    cleanup();
    expect(anchor.style.getPropertyValue('anchor-name')).toBe('');
    vi.unstubAllGlobals();
  });

  it('attachAnchoredPanel falls back to JS tracking when CSS anchoring is unsupported', () => {
    vi.stubGlobal('CSS', { supports: () => false });
    const anchor = makeAnchor({ top: 100, bottom: 120, left: 200, right: 300 });
    const panel = makePanel(150, 100);
    const cleanup = attachAnchoredPanel(panel, anchor);
    // Fallback path computes numeric pixel coordinates.
    expect(panel.style.top).toBe('124px');
    expect(panel.style.left).toBe('200px');
    cleanup();
    vi.unstubAllGlobals();
  });

  it('repositions on scroll', () => {
    const rect = { top: 100, bottom: 120, left: 200, right: 300, width: 100, height: 20, x: 200, y: 100 } as DOMRect;
    const anchor = document.createElement('button');
    anchor.getBoundingClientRect = () => ({ ...rect });
    const panel = makePanel(150, 100);
    const cleanup = trackAnchoredPosition(panel, anchor);
    expect(panel.style.top).toBe('124px');
    // Simulate the anchor moving up as the page scrolls.
    rect.top = 50; rect.bottom = 70;
    window.dispatchEvent(new Event('scroll'));
    expect(panel.style.top).toBe('74px');
    cleanup();
  });
});
