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
