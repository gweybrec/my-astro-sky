/**
 * Pure (DOM-free) logic for observation windows drawn on a plan entry's night
 * trajectory. Kept out of `targets-view.ts` so it can be unit-tested. Rendering
 * and drag handling live in `targets-view.ts` (interactive) and
 * `export-render.ts` (PDF); persistence/validation on the server mirrors
 * `sanitizeObservationWindows` in `server/db.ts`.
 */

import type { ObservationWindow } from './api';
import { filterCssKey } from './chip-utils';

/** Minimum window width as a fraction of the night window (keeps edges grabbable). */
export const MIN_WINDOW_FRAC = 0.02;

/** Default span of a freshly added window (centred on the night). */
const DEFAULT_START_FRAC = 0.35;
const DEFAULT_END_FRAC = 0.65;

function genWindowId(): string {
  return `ow-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/**
 * Validate/coerce a raw value into a well-formed ObservationWindow array:
 * clamp fractions to [0,1], enforce `startFrac < endFrac` with a minimum width,
 * normalise filter/color to non-empty strings or null, and ensure each has an id.
 * Malformed entries (non-object, non-finite fractions) are dropped.
 */
export function sanitizeObservationWindows(raw: unknown): ObservationWindow[] {
  if (!Array.isArray(raw)) return [];
  const out: ObservationWindow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const rawStart = Number(r.startFrac);
    const rawEnd = Number(r.endFrac);
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) continue;
    let start = clamp01(rawStart);
    let end = clamp01(rawEnd);
    if (end < start) [start, end] = [end, start];
    if (end - start < MIN_WINDOW_FRAC) {
      end = Math.min(1, start + MIN_WINDOW_FRAC);
      if (end - start < MIN_WINDOW_FRAC) start = Math.max(0, end - MIN_WINDOW_FRAC);
    }
    const filter =
      typeof r.filter === 'string' && r.filter.trim() ? r.filter.trim().slice(0, 40) : null;
    const color =
      typeof r.color === 'string' && r.color.trim() ? r.color.trim().slice(0, 64) : null;
    const frameSeconds =
      Number.isFinite(Number(r.frameSeconds)) && Number(r.frameSeconds) > 0
        ? Number(r.frameSeconds)
        : null;
    // Absent on windows created before this field existed → treat as off.
    const snap = typeof r.snap === 'boolean' ? r.snap : false;
    const id = typeof r.id === 'string' && r.id.trim() ? r.id.trim().slice(0, 64) : genWindowId();
    out.push({ id, startFrac: start, endFrac: end, filter, color, frameSeconds, snap });
  }
  return out;
}

/**
 * Build a default observation window: centred on the night, with no filter, no
 * colour override (neutral) and no single-frame duration — the user fills these in.
 */
export function newObservationWindow(): ObservationWindow {
  return {
    id: genWindowId(),
    startFrac: DEFAULT_START_FRAC,
    endFrac: DEFAULT_END_FRAC,
    filter: null,
    color: null,
    frameSeconds: null,
    // The "link" (snap-to-frame) toggle is on by default for new windows.
    snap: true,
  };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Local-time HH:MM clock label for a fraction of the night window. */
export function fracToClock(frac: number, win: { start: Date; end: Date }): string {
  const span = win.end.getTime() - win.start.getTime();
  const d = new Date(win.start.getTime() + clamp01(frac) * span);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Convert an HH:MM clock string back to a fraction of the night window. Times
 * earlier than the window start are treated as the following day (the night
 * wraps past midnight). Returns null for unparseable input; the result is
 * clamped to [0,1].
 */
export function clockToFrac(hhmm: string, win: { start: Date; end: Date }): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? '').trim());
  if (!m) return null;
  const hh = +m[1];
  const mm = +m[2];
  if (hh > 23 || mm > 59) return null;
  const cand = new Date(win.start);
  cand.setHours(hh, mm, 0, 0);
  let t = cand.getTime();
  if (t < win.start.getTime()) t += 86_400_000; // window crosses midnight
  const span = win.end.getTime() - win.start.getTime() || 1;
  return clamp01((t - win.start.getTime()) / span);
}

/** Duration of a window in milliseconds given the total night-window span. */
export function windowDurationMs(w: ObservationWindow, nightSpanMs: number): number {
  return Math.max(0, (w.endFrac - w.startFrac) * nightSpanMs);
}

/**
 * How many whole single-frame subs of `frameSeconds` fit in the window, or null
 * when no frame duration is set. Mirrors the photo "N × sub s" reading.
 */
export function framesInWindow(w: ObservationWindow, nightSpanMs: number): number | null {
  if (!w.frameSeconds || w.frameSeconds <= 0) return null;
  return Math.floor(windowDurationMs(w, nightSpanMs) / 1000 / w.frameSeconds);
}

/**
 * Discrete HH:MM options spanning the night window at `stepMinutes`, for the
 * per-window from/to time dropdown (the same widget the targets search uses).
 * Always includes the exact window start and end.
 */
export function windowTimeOptions(win: { start: Date; end: Date }, stepMinutes = 15): string[] {
  const stepMs = stepMinutes * 60_000;
  const startMs = win.start.getTime();
  const endMs = win.end.getTime();
  const out: string[] = [fracToClock(0, win)];
  // First grid tick strictly after the start, then every step up to the end.
  let t = Math.ceil((startMs + 1) / stepMs) * stepMs;
  for (; t < endMs; t += stepMs) out.push(fracToClock((t - startMs) / (endMs - startMs || 1), win));
  const endLabel = fracToClock(1, win);
  if (out[out.length - 1] !== endLabel) out.push(endLabel);
  return out;
}

/** Compact H:MM / M-minute label for a duration in milliseconds. */
export function formatWindowDuration(ms: number): string {
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

/**
 * Resolve the concrete CSS colour a window should paint with. An explicit
 * `color` override wins; otherwise fall back to the filter's `--filter-{key}`
 * token (read from the document so it respects the active theme). `readVar`
 * is injected so this stays testable without a DOM.
 */
export function resolveWindowColor(
  w: Pick<ObservationWindow, 'filter' | 'color'>,
  readVar: (cssVar: string) => string,
): string {
  if (w.color) return w.color;
  const token = readVar(`--filter-${filterCssKey(w.filter)}`).trim();
  return token || readVar('--filter-custom').trim() || 'rgba(40,80,160,0.5)';
}

/**
 * Convert a CSS colour string (`#rgb`, `#rrggbb`, or `rgb()/rgba()`) to a
 * `#rrggbb` hex — the only form a native `<input type="color">` accepts. Alpha
 * is dropped. Unparseable input falls back to a neutral blue.
 */
export function cssColorToHex(str: string): string {
  const s = (str ?? '').trim();
  const toHex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    if (hex.length === 3) return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
    if (hex.length >= 6) return `#${hex.slice(0, 6)}`;
    return '#3b6fd0';
  }
  const m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) return `#${toHex(+m[1])}${toHex(+m[2])}${toHex(+m[3])}`;
  return '#3b6fd0';
}

/** A `#rrggbb` (or `#rgb`) hex as an `rgba()` string at the given alpha. */
export function hexToRgba(hex: string, alpha: number): string {
  const h = cssColorToHex(hex).slice(1);
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Fill colour for a window band: the interior must stay translucent so the
 * trajectory shows through. Filter-token colours already carry alpha and pass
 * through unchanged; an opaque user-picked hex is converted to rgba at `alpha`.
 */
export function toBandFill(color: string, alpha = 0.3): string {
  return color.trim().startsWith('#') ? hexToRgba(color, alpha) : color;
}
