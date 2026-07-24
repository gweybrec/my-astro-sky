/**
 * Tiny colour helpers for canvas drawing. Pure and unit-tested.
 */

function parseRgb(s: string): [number, number, number, number] {
  const m = s.match(/rgba?\(([^)]+)\)/i);
  if (!m) return [255, 255, 255, 1];
  const p = m[1].split(',').map((v) => parseFloat(v.trim()));
  return [p[0] || 0, p[1] || 0, p[2] || 0, p[3] ?? 1];
}

/**
 * Linearly interpolate between two `rgb()`/`rgba()` colours. `t` is clamped to
 * [0,1]; channels are rounded, alpha kept to 3 decimals. Returns an `rgba(...)`.
 */
export function lerpColor(a: string, b: string, t: number): string {
  const tt = Math.max(0, Math.min(1, t));
  const ca = parseRgb(a);
  const cb = parseRgb(b);
  const ch = (i: number) => ca[i] + (cb[i] - ca[i]) * tt;
  const r = Math.round(ch(0));
  const g = Math.round(ch(1));
  const bl = Math.round(ch(2));
  const al = Math.round(ch(3) * 1000) / 1000;
  return `rgba(${r}, ${g}, ${bl}, ${al})`;
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
  const [r, g, b] = hexChannels(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function hexChannels(hex: string): [number, number, number] {
  const h = cssColorToHex(hex).slice(1);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** The three colours a filter badge needs, derived from one catalog hex. */
export interface BadgeColors {
  bg: string;
  text: string;
  border: string;
}

/**
 * Derive a filter badge's background / text / border from a single `#rrggbb`.
 *
 * Mirrors how the legacy `--filter-*` token trios are built (see
 * src/styles/tokens.css): a translucent fill so the badge sits quietly on the
 * dark UI, a slightly stronger border, and a bright tint of the same hue for the
 * label. The text tint is the hue lightened toward white — dark hues like the
 * deep violet used by dual-band filters would otherwise be unreadable at the
 * small badge font size.
 */
export function filterBadgeColors(hex: string): BadgeColors {
  const [r, g, b] = hexChannels(hex);
  const lighten = (c: number) => Math.round(c + (255 - c) * 0.55);
  return {
    bg: `rgba(${r}, ${g}, ${b}, 0.4)`,
    text: `rgb(${lighten(r)}, ${lighten(g)}, ${lighten(b)})`,
    border: `rgba(${r}, ${g}, ${b}, 0.55)`,
  };
}
