/**
 * Cursor hit-testing against stars, DSOs and terrain summits, extracted from
 * `sky-map.ts`.
 *
 * Owns the two hover spatial indexes and their cache keys. Both indexes are built as a
 * **superset** of what is drawn — the precise "would this actually render?" gating is a
 * separate step ({@link isStarRendered} for stars, `DsoRenderSelection.has()` for DSOs)
 * — so hover and click always agree with the render pass rather than approximating it.
 *
 * Everything the queries depend on is passed in per call, so no view or display state
 * is duplicated here.
 */
import type { DSO, Point, Star, ViewState } from './types';
import type { HorizonProfile, HorizonSummit } from './horizon-io';
import type { HorizonParams } from './sky-map-types';
import { project, projectCached, toCanvas, fromCanvas } from './projection';
import { getStars } from './star-catalog';
import { getDSOs } from './dso-catalog';
import { SpatialIndex } from './spatial-index';
import { pickDsoAtCursor } from './hover-hit-test';
import { pointInConvexPolygon } from './photo-outline';
import { raDecFromAltAz } from './sky-geometry';
import { starFaintLimitAt, type StarAreaBudget } from './star-budget';

/** Display state the DSO index depends on (mirrors the render-pass filters). */
export interface DsoIndexFilters {
  visibleTypes: Set<string>;
  visibleCatalogs: Set<string>;
  highlightedId: string | null;
}

export class SkyHitTest {
  private starIndex = new SpatialIndex<Star>(0.02);
  private dsoIndex = new SpatialIndex<DSO>(0.02);
  private starIndexMaxMag = -1;
  private dsoIndexMaxMag = -99999; // Sentinel value meaning "not initialized"

  /** Force both indexes to rebuild on next use (projection or filter change). */
  invalidate(): void {
    this.starIndexMaxMag = -1;
    this.dsoIndexMaxMag = -99999;
  }

  /** Force only the DSO index to rebuild (type/catalog/highlight change). */
  invalidateDsoIndex(): void {
    this.dsoIndexMaxMag = -99999;
  }

  /** Force only the star index to rebuild (highlighted star change). */
  invalidateStarIndex(): void {
    this.starIndexMaxMag = -1;
  }

  private buildStarIndex(maxMag: number): void {
    if (maxMag === this.starIndexMaxMag) return;
    this.starIndexMaxMag = maxMag;
    this.starIndex.clear();
    for (const star of getStars()) {
      if (star.mag > maxMag) continue;
      projectCached(star);
      this.starIndex.insert(star, star._px!, star._py!);
    }
  }

  private buildDsoIndex(maxMag: number | null, f: DsoIndexFilters): void {
    // Convert maxMag to a cache key (null becomes -999 for different behavior than computed values)
    const cacheKey = maxMag === null ? -999 : maxMag;
    if (cacheKey === this.dsoIndexMaxMag) return;
    this.dsoIndexMaxMag = cacheKey;
    this.dsoIndex.clear();
    for (const dso of getDSOs()) {
      const isHighlighted = f.highlightedId === dso.id;

      if (!isHighlighted) {
        if (!f.visibleTypes.has(dso.type)) continue;
        const cat = dso.catalog;
        if (cat && !f.visibleCatalogs.has(cat)) continue;
        if (maxMag !== null && dso.mag !== null && dso.mag > maxMag) continue;
        if (dso.mag === null && maxMag !== null) continue;
      }

      projectCached(dso);
      this.dsoIndex.insert(dso, dso._px!, dso._py!);
    }
  }

  /**
   * Nearest star to the cursor within ~8 px, or null. `maxMag` must match the
   * renderer's magnitude gate so the index stays a superset of what is drawn
   * ({@link isStarRendered} does the final confirm).
   */
  findClosestStar(mx: number, my: number, view: ViewState, maxMag: number): Star | null {
    this.buildStarIndex(maxMag);
    const projPt = fromCanvas(mx, my, view);
    const threshold = 8 / view.scale;
    return this.starIndex.findNearest(projPt.x, projPt.y, threshold);
  }

  /**
   * DSO under the cursor, or null. DSOs are gated by priority (not magnitude), so the
   * hit-test index includes all catalog DSOs — a superset of what is drawn; the caller's
   * render selection does the precise gating.
   */
  findClosestDSO(mx: number, my: number, view: ViewState, f: DsoIndexFilters): DSO | null {
    this.buildDsoIndex(null, f);
    const projPt = fromCanvas(mx, my, view);

    // Generous threshold collects all nearby DSO centres: large DSOs (e.g. M42 at 90')
    // have centres far from the cursor even when it sits inside their rendered ellipse.
    const generousThreshold = 200 / view.scale;
    const candidates = this.dsoIndex.findAll(projPt.x, projPt.y, generousThreshold);
    return pickDsoAtCursor(candidates, mx, my, view);
  }

  /**
   * DSOs whose centre falls inside the given frame polygon, sorted by distance to the
   * frame centre (nearest first). Used to derive a plan frame's target after a move.
   */
  dsosInFrame(
    geo: { corners: Point[]; cx: number; cy: number; halfW: number; halfH: number },
    view: ViewState,
    maxMag: number,
    f: DsoIndexFilters,
  ): DSO[] {
    this.buildDsoIndex(maxMag, f);

    const { corners, cx, cy, halfW, halfH } = geo;
    const projCenter = fromCanvas(cx, cy, view);
    // Collect candidates around the frame centre out to its half-diagonal (+margin).
    const radiusPx = Math.hypot(halfW, halfH) + 4;
    const candidates = this.dsoIndex.findAll(projCenter.x, projCenter.y, radiusPx / view.scale);

    const inside: Array<{ dso: DSO; dist: number }> = [];
    for (const dso of candidates) {
      const p = project(dso.ra, dso.dec);
      const c = toCanvas(p.x, p.y, view);
      if (pointInConvexPolygon(c.x, c.y, corners)) {
        inside.push({ dso, dist: Math.hypot(c.x - cx, c.y - cy) });
      }
    }
    inside.sort((a, b) => a.dist - b.dist);
    return inside.map((e) => e.dso);
  }

  /**
   * Nearest terrain summit dot to the cursor, within ~12 px, or null. Distance is in
   * projection units (like the star/DSO hit-tests) so it can be compared against them.
   *
   * Pass `profile: null` when the mountain horizon is hidden — the visibility gate is
   * the caller's, this only answers "what is under the cursor".
   */
  findClosestSummit(
    mx: number,
    my: number,
    view: ViewState,
    profile: HorizonProfile | null,
    horizon: HorizonParams | null,
  ): { summit: HorizonSummit; dist: number } | null {
    const summits = profile?.summits;
    if (!summits?.length || !horizon) return null;
    const projPt = fromCanvas(mx, my, view);
    const threshold = 12 / view.scale; // ~12 px
    let best: { summit: HorizonSummit; dist: number } | null = null;
    for (const s of summits) {
      const { raDeg, decDeg } = raDecFromAltAz(s.altDeg, s.azDeg, horizon.lstH, horizon.latDeg);
      const p = project(raDeg, decDeg);
      if (p.x >= 1e5) continue;
      const dist = Math.hypot(p.x - projPt.x, p.y - projPt.y);
      if (dist <= threshold && (!best || dist < best.dist)) best = { summit: s, dist };
    }
    return best;
  }
}

/**
 * Whether a star would actually be drawn: the same area-weighted per-position magnitude
 * gate the render loop applies (the highlighted star always shows), plus the viewport
 * bounds — so hover/click matches exactly what is drawn.
 */
export function isStarRendered(
  star: Star,
  view: ViewState,
  budget: StarAreaBudget,
  highlightedStarHip: number | null,
): boolean {
  const p = project(star.ra, star.dec);

  if (star.hip !== highlightedStarHip && star.mag > starFaintLimitAt(p.x, p.y, budget)) {
    return false;
  }

  const c = toCanvas(p.x, p.y, view);
  if (c.x < -20 || c.x > view.width + 20 || c.y < -20 || c.y > view.height + 20) {
    return false;
  }

  return true;
}
