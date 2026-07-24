import { describe, it, expect } from 'vitest';
import {
  sanitizeObservationWindows,
  newObservationWindow,
  windowDurationMs,
  framesInWindow,
  windowTimeOptions,
  formatWindowDuration,
  fracToClock,
  clockToFrac,
  resolveWindowColor,
  cssColorToHex,
  hexToRgba,
  toBandFill,
  MIN_WINDOW_FRAC,
} from '../../src/observation-windows';

describe('sanitizeObservationWindows', () => {
  it('drops non-array and malformed entries', () => {
    expect(sanitizeObservationWindows(null)).toEqual([]);
    expect(sanitizeObservationWindows('x')).toEqual([]);
    expect(sanitizeObservationWindows([null, 42, {}, { startFrac: 'a', endFrac: 0.5 }])).toEqual(
      [],
    );
  });

  it('clamps fractions into [0,1]', () => {
    const [w] = sanitizeObservationWindows([{ startFrac: -0.5, endFrac: 2, filter: null }]);
    expect(w.startFrac).toBe(0);
    expect(w.endFrac).toBe(1);
  });

  it('swaps reversed edges and enforces a minimum width', () => {
    const [w] = sanitizeObservationWindows([{ startFrac: 0.8, endFrac: 0.799 }]);
    expect(w.startFrac).toBeLessThan(w.endFrac);
    expect(w.endFrac - w.startFrac).toBeGreaterThanOrEqual(MIN_WINDOW_FRAC - 1e-9);
  });

  it('keeps the min-width window inside [0,1] when clamped at the right edge', () => {
    const [w] = sanitizeObservationWindows([{ startFrac: 1, endFrac: 1 }]);
    expect(w.endFrac).toBeLessThanOrEqual(1);
    expect(w.startFrac).toBeGreaterThanOrEqual(0);
    expect(w.endFrac - w.startFrac).toBeGreaterThanOrEqual(MIN_WINDOW_FRAC - 1e-9);
  });

  it('normalises filter/color to trimmed strings or null and assigns an id', () => {
    const [w] = sanitizeObservationWindows([
      { startFrac: 0.1, endFrac: 0.5, filter: '  Ha ', color: '   ' },
    ]);
    expect(w.filter).toBe('Ha');
    expect(w.color).toBeNull();
    expect(typeof w.id).toBe('string');
    expect(w.id.length).toBeGreaterThan(0);
  });

  it('coerces frameSeconds to a positive number or null', () => {
    expect(
      sanitizeObservationWindows([{ startFrac: 0.1, endFrac: 0.5, frameSeconds: 300 }])[0]
        .frameSeconds,
    ).toBe(300);
    expect(
      sanitizeObservationWindows([{ startFrac: 0.1, endFrac: 0.5, frameSeconds: 0 }])[0]
        .frameSeconds,
    ).toBeNull();
    expect(
      sanitizeObservationWindows([{ startFrac: 0.1, endFrac: 0.5, frameSeconds: -5 }])[0]
        .frameSeconds,
    ).toBeNull();
    expect(
      sanitizeObservationWindows([{ startFrac: 0.1, endFrac: 0.5, frameSeconds: 'x' }])[0]
        .frameSeconds,
    ).toBeNull();
  });

  it('preserves a boolean snap and defaults a missing one to false', () => {
    expect(sanitizeObservationWindows([{ startFrac: 0.1, endFrac: 0.5, snap: true }])[0].snap).toBe(
      true,
    );
    expect(
      sanitizeObservationWindows([{ startFrac: 0.1, endFrac: 0.5, snap: false }])[0].snap,
    ).toBe(false);
    expect(sanitizeObservationWindows([{ startFrac: 0.1, endFrac: 0.5 }])[0].snap).toBe(false);
  });

  it('preserves an existing id', () => {
    const [w] = sanitizeObservationWindows([{ id: 'keep-me', startFrac: 0.1, endFrac: 0.5 }]);
    expect(w.id).toBe('keep-me');
  });
});

describe('newObservationWindow', () => {
  it('starts blank (no filter/colour/frame) with the link toggle on by default', () => {
    const w = newObservationWindow();
    expect(w.filter).toBeNull();
    expect(w.color).toBeNull();
    expect(w.frameSeconds).toBeNull();
    expect(w.snap).toBe(true);
    expect(w.startFrac).toBeLessThan(w.endFrac);
  });
});

describe('fracToClock / clockToFrac', () => {
  // A night window that crosses midnight: 22:00 → 04:00 (6h).
  const win = {
    start: new Date(2026, 0, 1, 22, 0, 0),
    end: new Date(2026, 0, 2, 4, 0, 0),
  };

  it('maps fractions to local HH:MM', () => {
    expect(fracToClock(0, win)).toBe('22:00');
    expect(fracToClock(1, win)).toBe('04:00');
    expect(fracToClock(0.5, win)).toBe('01:00');
  });

  it('round-trips a clock time back to a fraction', () => {
    expect(clockToFrac('01:00', win)).toBeCloseTo(0.5, 6);
    expect(clockToFrac('22:00', win)).toBeCloseTo(0, 6);
    expect(clockToFrac('04:00', win)).toBeCloseTo(1, 6);
  });

  it('treats post-midnight times as the next day and clamps out-of-range', () => {
    expect(clockToFrac('23:00', win)).toBeCloseTo(1 / 6, 6);
    expect(clockToFrac('05:00', win)).toBe(1); // just past window end → clamped to 1
    // A time outside the window (before 22:00) wraps to the next day and clamps.
    expect(clockToFrac('20:00', win)).toBe(1);
  });

  it('returns null for unparseable input', () => {
    expect(clockToFrac('nope', win)).toBeNull();
    expect(clockToFrac('99:99', win)).toBeNull();
  });
});

describe('windowDurationMs / formatWindowDuration', () => {
  const night = 8 * 3600_000; // 8-hour night
  it('computes duration from the night span', () => {
    expect(
      windowDurationMs(
        {
          id: 'a',
          startFrac: 0.25,
          endFrac: 0.5,
          filter: null,
          color: null,
          frameSeconds: null,
          snap: false,
        },
        night,
      ),
    ).toBe(2 * 3600_000);
  });

  it('formats sub-hour and hour+minute durations', () => {
    expect(formatWindowDuration(45 * 60_000)).toBe('45m');
    expect(formatWindowDuration(90 * 60_000)).toBe('1h30');
    expect(formatWindowDuration(120 * 60_000)).toBe('2h');
  });
});

describe('framesInWindow', () => {
  const night = 8 * 3600_000; // 8-hour night
  const w = (
    startFrac: number,
    endFrac: number,
    frameSeconds: number | null,
  ): ObservationWindow => ({
    id: 'x',
    startFrac,
    endFrac,
    filter: null,
    color: null,
    frameSeconds,
    snap: false,
  });

  it('returns null when no frame duration is set', () => {
    expect(framesInWindow(w(0, 0.5, null), night)).toBeNull();
    expect(framesInWindow(w(0, 0.5, 0), night)).toBeNull();
  });

  it('counts whole subs that fit in the window duration', () => {
    // 0.25 of an 8h night = 2h = 7200s; at 300s subs → 24 frames.
    expect(framesInWindow(w(0.25, 0.5, 300), night)).toBe(24);
    // A partial sub does not count (floor): 7200s / 500s = 14.4 → 14.
    expect(framesInWindow(w(0.25, 0.5, 500), night)).toBe(14);
  });
});

describe('windowTimeOptions', () => {
  const win = { start: new Date(2026, 0, 1, 22, 0, 0), end: new Date(2026, 0, 2, 1, 0, 0) };

  it('spans the window at the given step and includes both endpoints', () => {
    const opts = windowTimeOptions(win, 30);
    expect(opts[0]).toBe('22:00');
    expect(opts[opts.length - 1]).toBe('01:00');
    expect(opts).toContain('23:30');
    expect(opts).toContain('00:00');
  });

  it('does not duplicate the end when it lands on the grid', () => {
    const opts = windowTimeOptions(win, 30);
    expect(opts.filter((o) => o === '01:00').length).toBe(1);
  });
});

describe('resolveWindowColor', () => {
  const readVar = (v: string): string =>
    ({
      '--filter-ha': 'rgba(180,40,40,0.4)',
      '--filter-custom': 'rgba(40,80,160,0.5)',
    })[v] ?? '';

  it('prefers an explicit override colour', () => {
    expect(resolveWindowColor({ filter: 'Ha', color: '#123456' }, readVar)).toBe('#123456');
  });

  it("derives from the filter's token when no override", () => {
    expect(resolveWindowColor({ filter: 'Ha', color: null }, readVar)).toBe('rgba(180,40,40,0.4)');
  });

  it('falls back to the custom token for an unknown filter', () => {
    expect(resolveWindowColor({ filter: 'ZZ', color: null }, readVar)).toBe('rgba(40,80,160,0.5)');
  });

  // ── Catalog filters ────────────────────────────────────────────────────────
  // Without the catalog lookup, every real filter product would hit the `custom`
  // branch above and every band would paint the same generic blue.
  const resolveCatalogColor = (name: string): string | null =>
    name === 'Antlia ALP-T Dual Band 5nm' ? '#501e96' : null;

  it("uses the catalog filter's own colour when it names a product", () => {
    expect(
      resolveWindowColor(
        { filter: 'Antlia ALP-T Dual Band 5nm', color: null },
        readVar,
        resolveCatalogColor,
      ),
    ).toBe('#501e96');
  });

  it('an explicit override still beats the catalog colour', () => {
    expect(
      resolveWindowColor(
        { filter: 'Antlia ALP-T Dual Band 5nm', color: '#123456' },
        readVar,
        resolveCatalogColor,
      ),
    ).toBe('#123456');
  });

  it('a generic band name keeps its token even when a catalog is available', () => {
    expect(resolveWindowColor({ filter: 'Ha', color: null }, readVar, resolveCatalogColor)).toBe(
      'rgba(180,40,40,0.4)',
    );
  });

  it('falls through to the custom token when the catalog has not loaded', () => {
    expect(
      resolveWindowColor(
        { filter: 'Antlia ALP-T Dual Band 5nm', color: null },
        readVar,
        () => null,
      ),
    ).toBe('rgba(40,80,160,0.5)');
  });

  it('handles a null filter with a catalog resolver present', () => {
    expect(resolveWindowColor({ filter: null, color: null }, readVar, resolveCatalogColor)).toBe(
      'rgba(40,80,160,0.5)',
    );
  });
});

describe('cssColorToHex', () => {
  it('passes through 6-digit hex', () => {
    expect(cssColorToHex('#12ab34')).toBe('#12ab34');
  });

  it('expands 3-digit hex', () => {
    expect(cssColorToHex('#abc')).toBe('#aabbcc');
  });

  it('parses rgb / rgba dropping alpha', () => {
    expect(cssColorToHex('rgba(180,40,40,0.4)')).toBe('#b42828');
    expect(cssColorToHex('rgb(30, 100, 200)')).toBe('#1e64c8');
  });

  it('falls back for unparseable input', () => {
    expect(cssColorToHex('nonsense')).toBe('#3b6fd0');
    expect(cssColorToHex('')).toBe('#3b6fd0');
  });
});

describe('hexToRgba / toBandFill', () => {
  it('converts a hex to rgba at the given alpha', () => {
    expect(hexToRgba('#12ab34', 0.3)).toBe('rgba(18, 171, 52, 0.3)');
    expect(hexToRgba('#abc', 0.5)).toBe('rgba(170, 187, 204, 0.5)');
  });

  it('makes an opaque user hex translucent but leaves token rgba untouched', () => {
    // A custom green picked in the colour input must not paint an opaque band.
    expect(toBandFill('#00ff00', 0.3)).toBe('rgba(0, 255, 0, 0.3)');
    // A filter token already carries its own alpha — pass it through.
    expect(toBandFill('rgba(180,40,40,0.4)')).toBe('rgba(180,40,40,0.4)');
  });
});
