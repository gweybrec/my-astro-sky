/**
 * Pure geometry helpers for user-drawn sky regions: freehand Alt/Az polygons
 * captured on the Local Sky (zenith-centered) view (see projection.ts's
 * `CenterMode: 'zenith'`) and used as a Targets search filter.
 *
 * Kept independent of projection.ts's module-level observer state (lstH/latDeg)
 * since Alt/Az is already observer-relative — the same stereographic radial
 * form as project()'s zenith branch, just parameterized directly by az/alt
 * instead of going through RA/Dec first. This is the shared 2D plane both the
 * draw capture (sky-map.ts) and the filter evaluation (targets-view.ts) must
 * agree on, so azimuth wraparound (0°/360°) and polar distortion near the
 * zenith are handled the same way angles always are — never as raw-degree
 * range comparisons.
 */

const DEG2RAD = Math.PI / 180;

export interface Point2D {
  x: number;
  y: number;
}

export interface AzAlt {
  azDeg: number;
  altDeg: number;
}

/**
 * Zenith-centered stereographic projection of a raw Alt/Az point onto the unit
 * disc: alt=90° (zenith) → origin, alt=0° (horizon) → disc edge (r=1). Mirrors
 * projection.ts's `project()` zenith branch exactly (including the x-negation
 * for East-on-screen-left), but skips the RA/Dec → Alt/Az conversion since the
 * input is already Alt/Az.
 */
export function projectAzAlt(azDeg: number, altDeg: number): Point2D {
  const azRad = azDeg * DEG2RAD;
  const r = Math.tan(((90 - altDeg) / 2) * DEG2RAD);
  return { x: -r * Math.sin(azRad), y: r * Math.cos(azRad) };
}

/** Standard ray-casting point-in-polygon test (polygon need not be explicitly closed). */
export function pointInPolygon(pt: Point2D, poly: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersects = yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * True if the given Alt/Az point falls within the region's drawn polygon.
 * A point below the horizon (altDeg < 0) is never "in" a region — regions are
 * always drawn above the horizon, so this also guards against the projection's
 * radial form blowing up (r → ∞ as altDeg → -90).
 */
export function isAltAzInRegion(
  azDeg: number,
  altDeg: number,
  region: { points: AzAlt[] },
): boolean {
  if (altDeg < 0) return false;
  const pt = projectAzAlt(azDeg, altDeg);
  const poly = region.points.map((p) => projectAzAlt(p.azDeg, p.altDeg));
  return pointInPolygon(pt, poly);
}
