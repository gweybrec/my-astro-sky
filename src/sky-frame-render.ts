/**
 * Overlay draw passes — FOV frames, photo outlines, the terrain horizon mass, the
 * cardinal labels and the sky-region polygons. Extracted from `sky-map.ts`.
 *
 * These are drawn onto the **overlay canvas**, which sits above the photo layer in the
 * DOM, so photos behind the mountains or under a frame are correctly hidden rather than
 * painted on top. An off-screen/export render has no overlay canvas, so the same passes
 * run inline against the main context — which is now simply "a scene with a different
 * `ctx`" rather than a temporary reassignment of the map's own context.
 */
import type { HorizonParams } from './sky-map-types';
import type { SkyScene } from './sky-scene';
import { t } from './i18n';
import { project, toCanvas, unproject, borderRadiusPU } from './projection';
import { raDecFromAltAz } from './sky-geometry';
import { canvasPxPerDeg, isSkyPointVisible, OFF_PROJECTION } from './sky-axes';
import { drawBodyMarker, drawBodyLabel } from './body-draw';
import { computeFovFrameCorners } from './frame-geometry';
import { angularSizeToCanvasPx } from './dso-render-math';
import { photoLabelEdgeIndex } from './photo-outline';
import {
  drawMountainHorizon,
  drawSummitDots,
  drawCardinalPoints,
  drawTileTrash,
  drawTileAdd,
} from './sky-draw';
import {
  drawFramePolyline,
  drawEdgeLabel,
  drawFrameHandles,
  drawResizeDraftRect,
  drawElasticSnapLine,
} from './frame-draw';
import { FRAME, PHOTO_OUTLINE, TRAJECTORY } from './canvas-theme';

/** Frame stroke/label colours resolved from CSS custom properties. */
interface FrameColors {
  stroke: string;
  label: string;
  active: string;
  danger: string;
}

function frameColors(s: SkyScene): FrameColors {
  const label = s.cssVar('--fov-frame-label', FRAME.labelFallback);
  return {
    stroke: s.cssVar('--fov-frame-stroke', FRAME.strokeFallback),
    label,
    active: s.cssVar('--accent-color', label),
    danger: s.cssVar('--color-danger', FRAME.dangerFallback),
  };
}

/**
 * Compose the whole overlay: terrain mass, frames, region polygons, cardinal labels —
 * in that order, so the N/E/S/W letters stay legible above everything else.
 *
 * `overlayScene` is a scene whose `ctx` is the overlay canvas. Returns early (leaving
 * the overlay cleared) when there is nothing to draw.
 */
export function renderOverlay(s: SkyScene): void {
  const { ctx, view } = s;
  const { width, height } = view;

  ctx.clearRect(0, 0, width, height);

  const horizon = s.skyTimeMode === 'date' ? s.horizon : null;
  const hasFrames = s.fovFrameSpecs.length > 0 || s.frames.frames.length > 0;
  const hasRegionDraw = s.regionDrawActive && s.regionDrawPoints.length > 0;
  const hasRegionOverlay = s.activeRegionOverlay !== null && s.localSkyMode;
  const hasTrajectory = s.trajectory !== null && s.localSkyMode && horizon !== null;
  if (!horizon && !hasFrames && !hasRegionDraw && !hasRegionOverlay && !hasTrajectory) return;

  const poleOrigin = toCanvas(0, 0, view);
  const borderR = borderRadiusPU(s.borderLatDeg) * view.scale;

  ctx.save();
  ctx.beginPath();
  ctx.arc(poleOrigin.x, poleOrigin.y, borderR, 0, Math.PI * 2);
  ctx.clip();

  // Terrain mass first (drawn above the photo layer so photos behind the mountains are
  // hidden — see the comment in the main render loop), then frames on top of that.
  if (horizon) renderMountainHorizon(s, horizon);

  if (s.fovFrameSpecs.length > 0) renderFovFrames(s);
  if (s.frames.frames.length > 0) renderFovInstances(s);

  if (hasRegionOverlay) renderRegionOverlay(s);
  if (hasRegionDraw) renderRegionDrawPreview(s);

  // Above the terrain, the photo layer and the frames — the whole point of the
  // trajectory is that it stays readable wherever it passes.
  if (hasTrajectory) renderTrajectory(s);

  // Cardinal labels last, so the N/E/S/W letters stay legible above the terrain
  // mass, the photo layer and the frames.
  if (horizon) renderCardinalPoints(s, horizon);

  ctx.restore();
}

/** Draws the red N/E/S/W horizon labels, if enabled. */
export function renderCardinalPoints(s: SkyScene, horizon: HorizonParams): void {
  if (!s.showCardinalPoints) return;
  drawCardinalPoints(s.ctx, s.view, horizon.lstH, horizon.latDeg, {
    n: t('cardinal.north'),
    e: t('cardinal.east'),
    s: t('cardinal.south'),
    w: t('cardinal.west'),
  });
}

/** Draws the mountain-horizon terrain mass (+ summit dots), if enabled. */
export function renderMountainHorizon(s: SkyScene, horizon: HorizonParams): void {
  if (!s.showMountainHorizon || !s.mountainProfile) return;
  drawMountainHorizon(s.ctx, s.view, horizon.lstH, horizon.latDeg, s.mountainProfile);
  if (s.mountainProfile.summits?.length) {
    drawSummitDots(s.ctx, s.view, horizon.lstH, horizon.latDeg, s.mountainProfile);
  }
}

/** Traces an Alt/Az polygon into the current path (shared by both region passes). */
function traceAltAzPath(
  s: SkyScene,
  points: readonly { azDeg: number; altDeg: number }[],
  horizon: HorizonParams,
): void {
  const { ctx, view } = s;
  points.forEach((p, i) => {
    const { raDeg, decDeg } = raDecFromAltAz(p.altDeg, p.azDeg, horizon.lstH, horizon.latDeg);
    const proj = project(raDeg, decDeg);
    const c = toCanvas(proj.x, proj.y, view);
    if (i === 0) ctx.moveTo(c.x, c.y);
    else ctx.lineTo(c.x, c.y);
  });
}

/** Draws the saved region reference overlay (see SkyMap.setActiveRegionOverlay). */
export function renderRegionOverlay(s: SkyScene): void {
  const { ctx } = s;
  const region = s.activeRegionOverlay;
  const hp = s.horizon;
  if (!region || !hp || region.points.length < 3) return;
  ctx.save();
  ctx.beginPath();
  traceAltAzPath(s, region.points, hp);
  ctx.closePath();
  ctx.fillStyle = `${region.color}40`; // ~25% alpha
  ctx.fill();
  ctx.strokeStyle = region.color;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

/**
 * Draws the highlighted object's night path across the local-sky dome: a bright
 * dotted arc plus a labelled dot every couple of hours (see sky-trajectory.ts).
 *
 * Unlike `traceAltAzPath`, this pen-lifts on below-horizon samples instead of
 * connecting them — a region is a closed polygon, an arc is not, and without the lift
 * the object's rise and set points would be joined by a chord straight across the sky.
 */
export function renderTrajectory(s: SkyScene): void {
  const { ctx, view } = s;
  const traj = s.trajectory;
  const hp = s.horizon;
  if (!traj || !hp) return;

  ctx.save();
  ctx.shadowColor = TRAJECTORY.halo;
  ctx.shadowBlur = TRAJECTORY.haloBlur;

  ctx.beginPath();
  let penDown = false;
  for (const sample of traj.samples) {
    const { raDeg, decDeg } = raDecFromAltAz(sample.altDeg, sample.azDeg, hp.lstH, hp.latDeg);
    const proj = project(raDeg, decDeg);
    if (proj.x >= OFF_PROJECTION) {
      penDown = false; // below the horizon — nothing to join to
      continue;
    }
    const c = toCanvas(proj.x, proj.y, view);
    if (penDown) ctx.lineTo(c.x, c.y);
    else {
      ctx.moveTo(c.x, c.y);
      penDown = true;
    }
  }
  ctx.strokeStyle = TRAJECTORY.color;
  ctx.lineWidth = TRAJECTORY.lineWidth;
  ctx.lineCap = 'round';
  ctx.setLineDash(TRAJECTORY.dash);
  ctx.stroke();
  ctx.setLineDash([]);

  for (const marker of traj.markers) {
    const { raDeg, decDeg } = raDecFromAltAz(marker.altDeg, marker.azDeg, hp.lstH, hp.latDeg);
    const proj = project(raDeg, decDeg);
    if (proj.x >= OFF_PROJECTION) continue;
    const c = toCanvas(proj.x, proj.y, view);
    drawBodyMarker(
      ctx,
      c.x,
      c.y,
      TRAJECTORY.markerRadius,
      TRAJECTORY.markerFill,
      TRAJECTORY.markerEdge,
    );
    drawBodyLabel(
      ctx,
      c.x,
      c.y,
      TRAJECTORY.markerRadius,
      marker.label,
      TRAJECTORY.labelColor,
      TRAJECTORY.labelFont,
    );
  }

  ctx.restore();
}

/** Draws the live in-progress freehand region stroke while drawing. */
export function renderRegionDrawPreview(s: SkyScene): void {
  const { ctx } = s;
  const hp = s.horizon;
  const points = s.regionDrawPoints;
  if (!hp || points.length === 0) return;
  ctx.save();
  ctx.beginPath();
  traceAltAzPath(s, points, hp);
  ctx.strokeStyle = '#4ea1ff';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  ctx.stroke();
  ctx.restore();
}

export function renderPhotoOutlines(s: SkyScene): void {
  const { ctx } = s;

  for (const outline of s.photoOutlines) {
    const { corners, name } = outline;
    if (corners.length < 4) continue;

    ctx.save();
    ctx.strokeStyle = PHOTO_OUTLINE.stroke;
    ctx.lineWidth = PHOTO_OUTLINE.lineWidth;
    ctx.setLineDash(PHOTO_OUTLINE.dash);
    drawFramePolyline(ctx, corners);

    // Label along the longest edge, always readable (not upside-down)
    drawEdgeLabel(ctx, corners, name, PHOTO_OUTLINE.label);
    ctx.restore();
  }
}

/** The legacy viewport-centred FOV previews (single global rotation). */
export function renderFovFrames(s: SkyScene): void {
  const { ctx, view } = s;
  const cx = view.width / 2;
  const cy = view.height / 2;
  // These previews sit at the screen centre, so their scale is the projection's scale at
  // the sky point under it — measured, not derived from dec, which is the wrong quantity
  // once the projection is zenith-centred (see sky-axes.ts).
  const { ra, dec } = unproject(view.centerX, view.centerY);
  const pxPerDeg = canvasPxPerDeg(ra, dec, view);
  const col = frameColors(s);

  for (const spec of s.fovFrameSpecs) {
    const halfWPx = (spec.wDeg / 2) * pxPerDeg;
    const halfHPx = (spec.hDeg / 2) * pxPerDeg;
    const corners = computeFovFrameCorners(halfWPx, halfHPx, cx, cy, s.fovRotationDeg);

    ctx.save();
    ctx.strokeStyle = col.stroke;
    ctx.lineWidth = FRAME.lineWidth;
    ctx.setLineDash(FRAME.dashOutline);
    drawFramePolyline(ctx, corners);
    drawEdgeLabel(ctx, corners, spec.label, col.label);
    ctx.restore();
  }
}

/** The interactive frame instances, their handles, and the mosaic edit affordances. */
export function renderFovInstances(s: SkyScene): void {
  const { ctx, view, frames } = s;
  const col = frameColors(s);
  // The selected mosaic's tiles each get a delete button (per-tile editing).
  const activeMosaicId = frames.frames.find((f) => f.active && f.isMosaicOutline)?.id.split(':')[2];

  for (const f of frames.frames) {
    if (f.visible === false) continue; // hidden via the manager checkbox
    // Off-projection (below the Local Sky horizon, or the far hemisphere in fisheye):
    // project() returns a sentinel there, so the frame would be painted far off-canvas
    // with zero extents and degenerate handles. Skip it outright.
    if (f.anchorKind === 'sky' && !isSkyPointVisible(f.ra ?? 0, f.dec ?? 0)) continue;
    const { corners, cx, cy, rotDeg, halfW, halfH } = frames.frameGeometry(f);
    const isActive = f.active;
    const isTile = !!f.mosaicId; // a faint mosaic panel (the outline frame draws the rest)

    ctx.save();
    ctx.globalAlpha = isTile ? 0.4 : isActive ? 1 : 0.5;
    ctx.strokeStyle = isActive && !isTile ? col.active : col.stroke;
    ctx.lineWidth = isActive && !isTile ? FRAME.lineWidthActive : FRAME.lineWidth;
    ctx.setLineDash(FRAME.dashOutline);
    // A mosaic outline traces its tile perimeter (follows projection curvature);
    // every other frame is its 4-corner rectangle.
    const outline = f.isMosaicOutline ? (frames.mosaicOutlinePath(f) ?? corners) : corners;
    drawFramePolyline(ctx, outline);

    if (isTile) {
      // Border tiles of the selected mosaic carry a delete button (large tiles only).
      if (
        f.mosaicId === activeMosaicId &&
        f.mosaicIsBorderTile &&
        frames.tileTrashVisible(halfW, halfH)
      ) {
        ctx.globalAlpha = 1;
        drawTileTrash(ctx, { x: cx, y: cy }, col.danger);
      }
      ctx.restore();
      continue; // tiles: outline only, no label/handles
    }

    // Label (setup name only) along the longest edge — hidden when the frame
    // is too small to read it.
    const edgeIdx = photoLabelEdgeIndex(corners);
    const a = corners[edgeIdx];
    const b = corners[(edgeIdx + 1) % corners.length];
    if (Math.hypot(b.x - a.x, b.y - a.y) >= FRAME.labelMinEdgePx) {
      drawEdgeLabel(ctx, corners, f.name, isActive ? col.active : col.label);
    }

    // Handles on the active frame only (so other frames stay locked), and only
    // while the frame is large enough that the centre dot isn't near the edges.
    if (isActive && frames.frameHandlesVisible(halfW, halfH)) {
      drawFrameHandles(
        ctx,
        { corners, cx, cy, rotDeg, halfH },
        {
          movable: f.movable,
          pinnable: !!f.pinnable,
          resizable: !!f.resizable,
          anchorSky: f.anchorKind === 'sky',
        },
        col.active,
        frames.framePinGlyphPos(corners[1], rotDeg),
      );
    }
    ctx.restore();
  }

  // Rubber-band preview of a drag-to-extend in progress.
  const draft = frames.resizeDraft;
  if (draft) {
    drawResizeDraftRect(
      ctx,
      computeFovFrameCorners(draft.halfW, draft.halfH, draft.cx, draft.cy, draft.rotDeg),
      col.active,
    );
  }

  // Elastic line: while moving a frame whose anchor will snap, a taut line runs
  // from the frame centre (cursor) to the pending DSO's centre. It tightens
  // (brighter + thicker) as the frame nears the break threshold, signalling the
  // snap-back that fires on release; it vanishes when the elastic "breaks".
  const snap = frames.snapCandidate;
  const drag = frames.activeDrag;
  if (snap && drag?.mode === 'move') {
    const f = frames.frames.find((x) => x.id === drag.id);
    if (f) {
      const { cx, cy } = frames.frameAnchorCanvas(f);
      const dp = project(snap.ra, snap.dec);
      const dc = toCanvas(dp.x, dp.y, view);
      // Break radius mirrors findClosestDSO: the rendered ellipse, floored at 20px.
      const rx = Math.max(2, angularSizeToCanvasPx(snap.majAxis / 2, snap.dec, view.scale));
      const breakPx = Math.max(rx, 20);
      const tension = Math.min(1, Math.hypot(cx - dc.x, cy - dc.y) / breakPx);
      drawElasticSnapLine(ctx, { x: cx, y: cy }, dc, tension, col.active);
    }
  }

  // Add ("+") buttons at the empty neighbour cells of the selected mosaic.
  if (
    activeMosaicId &&
    frames.mosaicAddCandidates.length &&
    frames.mosaicEditButtonsVisible(activeMosaicId)
  ) {
    const avoid = frames.activeOutlineRotateAvoid();
    for (const c of frames.mosaicAddCandidates)
      drawTileAdd(ctx, frames.candidateCanvasPoint(c, avoid), col.active);
  }
}
