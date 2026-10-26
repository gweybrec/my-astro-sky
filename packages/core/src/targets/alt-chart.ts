import type { AltSample } from '../sky-geometry';

/**
 * The geometry of a target's altitude chart over the night: time across from the night's start to its end, altitude
 * up on a fixed 0–90° scale so all targets share it. Pure numbers in the chart's own units; the desktop's trajectory
 * chart (`TargetsView.buildAltChart`) and the phone's (`PhoneAltChart`) draw from it.
 */

/** The plot's edges in the chart's units: time runs from `left` to `right`, 90° is at `top`, 0° at `bottom`. */
export interface AltChartBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The altitudes the chart marks with a line, 0° included. */
export const ALT_CHART_TICKS = [0, 20, 40, 60, 80];

export function altChartScale(win: { start: Date; end: Date }, box: AltChartBox) {
  const span = win.end.getTime() - win.start.getTime() || 1;
  const xAt = (d: Date) =>
    box.left + ((d.getTime() - win.start.getTime()) / span) * (box.right - box.left);
  const yAt = (altDeg: number) => {
    const a = Math.max(0, Math.min(90, altDeg));
    return box.top + (1 - a / 90) * (box.bottom - box.top);
  };
  return { xAt, yAt, ticks: ALT_CHART_TICKS.map((deg) => ({ deg, y: yAt(deg) })) };
}

/** An observation window of the night, as fractions of it, and the colour it is drawn in. */
export interface AltChartWindow {
  startFrac: number;
  endFrac: number;
  color: string;
}

export interface AltChartLayout {
  /** The altitude lines, 0° first. */
  ticks: { deg: number; y: number }[];
  /** The target's curve and the Moon's, as SVG polyline points ("x,y x,y …"); the Moon's is null without a Moon. */
  curve: string;
  moon: string | null;
  /** Where the best time is, or null outside the night. */
  bestX: number | null;
  windows: { x: number; width: number; color: string }[];
  /** The whole hours marked under the plot, every `hourStep` hours of the local clock. */
  hours: { x: number; time: Date }[];
}

const points = (samples: AltSample[], xAt: (d: Date) => number, yAt: (a: number) => number) =>
  samples.map((s) => `${xAt(s.time).toFixed(1)},${yAt(s.altDeg).toFixed(1)}`).join(' ');

/** Everything a chart of the night draws: lines, curves, the best time, the windows and the hour marks. */
export function altChartLayout(options: {
  curve: AltSample[];
  win: { start: Date; end: Date };
  bestTime: Date | null;
  moonCurve?: AltSample[] | null;
  windows?: AltChartWindow[];
  box: AltChartBox;
  hourStep?: number;
}): AltChartLayout {
  const { curve, win, bestTime, moonCurve, windows = [], box, hourStep = 2 } = options;
  const { xAt, yAt, ticks } = altChartScale(win, box);
  const width = box.right - box.left;
  const start = win.start.getTime();
  const end = win.end.getTime();

  const hours: { x: number; time: Date }[] = [];
  const t = new Date(start);
  t.setMinutes(0, 0, 0);
  if (t.getTime() < start) t.setHours(t.getHours() + 1);
  for (; t.getTime() <= end; t.setHours(t.getHours() + 1)) {
    if (t.getHours() % hourStep === 0) hours.push({ x: xAt(t), time: new Date(t) });
  }

  const best = bestTime ? bestTime.getTime() : NaN;
  return {
    ticks,
    curve: points(curve, xAt, yAt),
    moon: moonCurve?.length ? points(moonCurve, xAt, yAt) : null,
    bestX: best >= start && best <= end ? xAt(bestTime!) : null,
    windows: windows.map((w) => {
      const from = Math.max(0, Math.min(1, w.startFrac));
      const to = Math.max(from, Math.min(1, w.endFrac));
      return { x: box.left + from * width, width: (to - from) * width, color: w.color };
    }),
    hours,
  };
}
