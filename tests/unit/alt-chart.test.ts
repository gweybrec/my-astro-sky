import { describe, expect, it } from 'vitest';
import { altChartLayout, altChartScale } from '@myastrosky/core/targets/alt-chart';

// A night from 20:00 to 06:00 local time, drawn in a 100 × 90 box with no margins.
const start = new Date(2026, 9, 23, 20, 0);
const end = new Date(2026, 9, 24, 6, 0);
const win = { start, end };
const box = { left: 0, right: 100, top: 0, bottom: 90 };
const at = (h: number, m = 0) => new Date(2026, 9, h < 12 ? 24 : 23, h, m);

describe('altChartScale', () => {
  it('puts the night across and 0–90° up, clamping altitudes out of range', () => {
    const { xAt, yAt, ticks } = altChartScale(win, box);
    expect(xAt(start)).toBe(0);
    expect(xAt(end)).toBe(100);
    expect(xAt(at(1))).toBe(50);
    expect(yAt(90)).toBe(0);
    expect(yAt(0)).toBe(90);
    expect(yAt(45)).toBe(45);
    expect(yAt(-12)).toBe(90);
    expect(yAt(120)).toBe(0);
    expect(ticks.map((t) => t.deg)).toEqual([0, 20, 40, 60, 80]);
    [90, 70, 50, 30, 10].forEach((y, i) => expect(ticks[i].y).toBeCloseTo(y));
  });

  it('keeps the box margins (the desktop insets its plot)', () => {
    const { xAt, yAt } = altChartScale(win, { left: 2, right: 120, top: 7, bottom: 46 });
    expect(xAt(start)).toBe(2);
    expect(xAt(end)).toBe(120);
    expect(yAt(90)).toBe(7);
    expect(yAt(0)).toBe(46);
  });
});

describe('altChartLayout', () => {
  const curve = [
    { time: start, altDeg: 30 },
    { time: at(1), altDeg: 60 },
    { time: end, altDeg: 10 },
  ];

  it('draws the curve, the Moon, the best time, the windows and every second hour', () => {
    const layout = altChartLayout({
      curve,
      win,
      bestTime: at(1),
      moonCurve: [
        { time: start, altDeg: 0 },
        { time: end, altDeg: 45 },
      ],
      windows: [
        { startFrac: 0.1, endFrac: 0.3, color: 'red' },
        { startFrac: 0.9, endFrac: 1.4, color: 'blue' },
      ],
      box,
    });
    expect(layout.curve).toBe('0.0,60.0 50.0,30.0 100.0,80.0');
    expect(layout.moon).toBe('0.0,90.0 100.0,45.0');
    expect(layout.bestX).toBe(50);
    // a window running past the night's end stops at it
    expect(layout.windows.map((w) => w.color)).toEqual(['red', 'blue']);
    expect(layout.windows[0].x).toBeCloseTo(10);
    expect(layout.windows[0].width).toBeCloseTo(20);
    expect(layout.windows[1].x).toBeCloseTo(90);
    expect(layout.windows[1].width).toBeCloseTo(10);
    expect(layout.hours.map((h) => h.time.getHours())).toEqual([20, 22, 0, 2, 4, 6]);
    expect(layout.hours[1].x).toBe(20);
  });

  it('has no Moon and no best time when there are none in the night', () => {
    const layout = altChartLayout({ curve, win, bestTime: at(8), moonCurve: null, box });
    expect(layout.moon).toBeNull();
    expect(layout.bestX).toBeNull();
    expect(layout.windows).toEqual([]);
  });

  it('starts the hour marks at the first whole hour of the night', () => {
    const layout = altChartLayout({
      curve,
      win: { start: new Date(2026, 9, 23, 19, 40), end },
      bestTime: null,
      box,
      hourStep: 1,
    });
    expect(layout.hours[0].time.getHours()).toBe(20);
    expect(layout.hours[0].time.getMinutes()).toBe(0);
  });
});
