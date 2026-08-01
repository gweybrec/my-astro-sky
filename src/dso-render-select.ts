/**
 * DSO render selection, extracted from `sky-map.ts`.
 *
 * This is the **single source of truth** for which DSOs are drawn in a frame. It is
 * consumed by all three places that need that answer — the shape pass, the label pass,
 * and hover/click hit-test gating — so drawing and hit-testing can never disagree
 * (three copies of this logic used to drift apart).
 *
 * Two pieces of state live here:
 *
 * - **Position index** (`dsoAllIndex`) — every catalog DSO keyed by projected position,
 *   rebuilt only when the projection generation moves (hemisphere / mode / coordinate
 *   override), not per frame. Backs the viewport cull.
 * - **Per-frame cache** — the selection is computed lazily on first use in a frame and
 *   reused by the later consumers; `invalidate()` clears it at the top of each render.
 */
import type { DSO, ViewState } from './types';
import type { HorizonParams } from './sky-map-types';
import {
  projectCached,
  getProjectionGeneration,
  toCanvas,
  borderRadiusPU,
  isBelowHorizonCached,
  projectionAreaFactor,
} from './projection';
import { getDSOs, getDSOById, getDSOImportanceRank } from './dso-catalog';
import {
  selectDSOsToRender,
  DSO_CONTAINER_VISIBLE_RADIUS_PX,
  type SelectableDSO,
} from './dso-selection';
import { areaNormForBorderRadius } from './render-budget';
import { angularSizeToCanvasPx, dsoSizeCos2, DSO_GIANT_BODY_PU } from './dso-render-math';
import { SpatialIndex } from './spatial-index';

const DEG2RAD = Math.PI / 180;

/** Everything the selection depends on, resolved by the caller once per frame. */
export interface DsoSelectOptions {
  view: ViewState;
  borderLatDeg: number;
  hemisphere: 'north' | 'south';
  localSkyMode: boolean;
  fisheyeMode: boolean;
  visibleTypes: Set<string>;
  visibleCatalogs: Set<string>;
  /** Always selected, bypassing every filter and gate. */
  highlightedId: string | null;
  /** Observer params — only consulted in local-sky mode (below-horizon skip + altitude). */
  horizon: HorizonParams | null;
  /** Pan-invariant priority cutoff for this zoom + canvas. */
  priorityThreshold: number;
}

export class DsoRenderSelection {
  /**
   * All DSOs indexed by projection position (no mag/filter), for viewport culling.
   * Positions change only with the projection generation, so this is rebuilt once per
   * hemisphere/mode change (or DSO coordinate override), not per frame.
   */
  private allIndex = new SpatialIndex<DSO>(0.02);
  private giants: DSO[] = []; // bodies larger than the query margin; always considered
  private allIndexGen = -1;
  private maxBodyPU = 0; // largest indexed (non-giant) body radius (projection units)

  private cached: DSO[] | null = null;
  private cachedIds: Set<string> | null = null;

  /** Drop the per-frame cache; called at the top of each render. */
  invalidate(): void {
    this.cached = null;
    this.cachedIds = null;
  }

  /** True if `id` is in the current frame's selection. Requires a prior `select()`. */
  has(id: string): boolean {
    return this.cachedIds?.has(id) ?? false;
  }

  private ensureAllIndex(): void {
    const gen = getProjectionGeneration();
    if (this.allIndexGen === gen) return;
    this.allIndex.clear();
    this.giants = [];
    let maxBody = 0;
    for (const dso of getDSOs()) {
      projectCached(dso);
      // Body radius (projection units) = rx / scale, independent of zoom. A handful of
      // very large objects (Barnard's Loop, big LBN/LDN clouds) would force a wide query
      // margin for everyone, so they bypass the index and are always considered.
      const near = dso._px! * dso._px! + dso._py! * dso._py! < 4; // exclude far hemisphere
      const body = near ? (((dso.majAxis ?? 1) / 2 / 60) * DEG2RAD) / (2 * dsoSizeCos2(dso)) : 0;
      if (body > DSO_GIANT_BODY_PU) {
        this.giants.push(dso);
      } else {
        this.allIndex.insert(dso, dso._px!, dso._py!);
        if (body > maxBody) maxBody = body;
      }
    }
    this.maxBodyPU = maxBody;
    this.allIndexGen = gen;
  }

  /** The DSOs to draw this frame. Cached until {@link invalidate}. */
  select(opts: DsoSelectOptions): DSO[] {
    if (this.cached) return this.cached;
    const {
      view,
      borderLatDeg,
      hemisphere,
      localSkyMode,
      fisheyeMode,
      visibleTypes,
      visibleCatalogs,
      highlightedId,
      priorityThreshold,
    } = opts;

    // In zenith ("local sky") mode, DSO angular size must scale with altitude (the
    // projection's pole), not dec — see dsoSizeCos2. isBelowHorizonCached also
    // stamps _altDeg as a side effect, so this doubles as the altitude source.
    const horizon = localSkyMode ? opts.horizon : null;
    const dsoAltDeg = (d: DSO): number | undefined => {
      if (!horizon) return undefined;
      isBelowHorizonCached(d, horizon.lstH, horizon.latDeg);
      return d._altDeg;
    };

    // Viewport cull: query the position index for DSOs whose centre is within the
    // visible disc plus a margin for the largest body and the off-screen render margin.
    // This replaces a full scan of all ~12k DSOs every frame with a bounded query — a big
    // win when zoomed in (small viewport).
    this.ensureAllIndex();
    // The raw viewport radius grows as 1/scale, so zooming *out* makes it enormous and the
    // spatial query degenerates into a scan of a huge, mostly-empty region (it was 75% of
    // CPU in a zoom-out trace — see render-performance.md T5 addendum). But every DSO that
    // can actually be drawn lies within the border radius of the projection origin: objects
    // past it are unconditionally culled by the dec pre-filter below (and in stereo they
    // project to huge radii — dec −89° → r≈114 — so they can never be near the visible
    // sky). By the triangle inequality they all sit within (viewCentre→origin distance +
    // border radius) of the query centre, so capping queryR there never drops a drawable
    // object while keeping the query bounded when zoomed out. (+2° matches the pre-filter
    // margin; borderRadiusPU returns 1.0 in fisheye/zenith, where the far side is clipped.)
    const capR =
      Math.hypot(view.centerX, view.centerY) + borderRadiusPU(borderLatDeg + 2) + this.maxBodyPU;
    const queryR = Math.min(
      Math.hypot(view.width / 2, view.height / 2) / view.scale + this.maxBodyPU + 20 / view.scale,
      capR,
    );
    const nearby = this.allIndex.collect(view.centerX, view.centerY, queryR);

    // Area-normalisation for the area-weighted gate below (see render-budget.ts): the mean
    // projection area factor over the visible cap, so weighting compensates the projection
    // (thinner centre, denser edge) without changing the overall count.
    const aNorm = areaNormForBorderRadius(borderRadiusPU(borderLatDeg));
    // Rank DSOs by intrinsic quality (rating/brightness), NOT the blue-noise `priority`.
    // Gating the top count·A/aNorm by intrinsic quality makes on-screen DSO density track
    // the true sky (Milky Way / rich regions denser) with the projection bias removed —
    // the exact analogue of the star magnitude gate. `priority` would instead even out
    // that natural clustering.
    const qRank = getDSOImportanceRank();

    const candidates: (SelectableDSO & { dso: DSO })[] = [];
    // The spatial query covers normal-sized objects; the few giant DSOs (body larger
    // than the query margin) live outside the index and are always considered, so the
    // margin can stay tight without ever missing a large object near the edge.
    for (const src of [nearby, this.giants])
      for (const dso of src) {
        const isHighlighted = highlightedId === dso.id;

        if (!isHighlighted) {
          if (!visibleTypes.has(dso.type)) continue;
          const cat = dso.catalog;
          if (cat && !visibleCatalogs.has(cat)) continue;
          if (localSkyMode) {
            // Below-horizon DSOs are already hidden by the horizon-circle canvas
            // clip; this just skips the size/bbox work for them earlier.
            if (horizon && isBelowHorizonCached(dso, horizon.lstH, horizon.latDeg)) continue;
          } else if (!fisheyeMode) {
            // Dec pre-filter: skip objects clearly outside the border (stereo only
            // — in fisheye the far hemisphere is clipped by project() returning
            // off-canvas).
            if (hemisphere === 'north' && dso.dec < -(borderLatDeg + 2)) continue;
            if (hemisphere === 'south' && dso.dec > +(borderLatDeg + 2)) continue;
          }
          // Container gate: hide an inner object until its container renders large
          // enough on screen (so the container stays clean and clickable when zoomed out).
          if (dso.containerId && dso.containerId !== highlightedId) {
            const container = getDSOById(dso.containerId);
            if (container) {
              const cRx = Math.max(
                2,
                angularSizeToCanvasPx(
                  (container.majAxis ?? 1) / 2,
                  container.dec,
                  view.scale,
                  dsoSizeCos2(container, dsoAltDeg(container)),
                ),
              );
              if (cRx < DSO_CONTAINER_VISIBLE_RADIUS_PX) continue;
            }
          }
        }

        projectCached(dso);
        const c = toCanvas(dso._px!, dso._py!, view);
        const majorArcmin = dso.majAxis ?? 1;
        const rx = Math.max(
          2,
          angularSizeToCanvasPx(
            majorArcmin / 2,
            dso.dec,
            view.scale,
            dsoSizeCos2(dso, dsoAltDeg(dso)),
          ),
        );
        const margin = rx + 20;
        if (
          c.x < -margin ||
          c.x > view.width + margin ||
          c.y < -margin ||
          c.y > view.height + margin
        ) {
          continue;
        }

        // Screen-space (area-weighted) importance rank: scaling the intrinsic-quality rank
        // by aNorm/A removes the projection bias while preserving the true-sky distribution
        // — fewer DSOs near the crowded map centre (A≈1 → larger effective rank), more
        // toward the edge (A large → smaller). Because the rank is intrinsic (not spatially
        // spread), dense regions keep proportionally more of the top-N → natural clustering
        // survives. A=0 at the exact fisheye rim → never render (off-screen).
        const A = projectionAreaFactor(dso._px!, dso._py!);
        const rank = qRank.get(dso.id) ?? Number.MAX_SAFE_INTEGER;
        const effPriority = A > 0 ? (rank * aNorm) / A : Infinity;
        candidates.push({ id: dso.id, priority: effPriority, isHighlighted, dso });
      }

    const selected = selectDSOsToRender(candidates, priorityThreshold).map((s) => s.dso);
    this.cached = selected;
    this.cachedIds = new Set(selected.map((d) => d.id));
    return selected;
  }
}
