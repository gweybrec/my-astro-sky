/**
 * Pure decision logic for interactive FOV-frame drags, extracted from `sky-map.ts`
 * so the merge and resize maths can be unit-tested without a canvas or DOM events.
 * SkyMap keeps the event wiring and the in-flight drag/draft state; it calls these
 * to decide *what* a completed gesture means, then applies the result via callbacks.
 */
import type { ViewState } from './types';
import type { RenderableFrame, FovFrameResizeRegion } from './sky-map';
import { frameGeometry, canvasRotDegToPa } from './frame-geometry';
import { convexPolygonsOverlap } from './fov-frame-geometry';

/** Transient rubber-band rectangle produced while a resize drag is in progress. */
export interface ResizeDraft {
  cx: number;
  cy: number;
  halfW: number;
  halfH: number;
  rotDeg: number;
}

/**
 * After moving a standalone plan frame, find the frame or mosaic of the *same plan*
 * it now overlaps (so it can be merged), or null. Mirrors the old checkFrameMerge:
 * skips the moved frame, tiles, hidden frames, and anything not `plan:`/`mosaic:` of
 * the moved frame's plan; returns the first overlapping candidate.
 */
export function findMergeTarget(
  movedId: string,
  frames: RenderableFrame[],
  view: ViewState,
): string | null {
  const moved = frames.find((f) => f.id === movedId);
  if (!moved) return null;
  const movedPlan = movedId.split(':')[1];
  const movedCorners = frameGeometry(moved, view).corners;
  for (const f of frames) {
    if (f.id === movedId || f.mosaicId || f.visible === false) continue;
    const isFrameOrMosaic = f.id.startsWith('plan:') || f.id.startsWith('mosaic:');
    if (!isFrameOrMosaic || f.id.split(':')[1] !== movedPlan) continue;
    if (convexPolygonsOverlap(movedCorners, frameGeometry(f, view).corners)) {
      return f.id;
    }
  }
  return null;
}

/**
 * Convert a completed drag-to-extend rubber-band rectangle into a sky region
 * (centre + angular size + PA) for the resize callback. The angular size scales the
 * frame's single-tile FOV by the px ratio (so it stays correct at the frame's
 * location) rather than re-inverting the projection.
 */
export function resizeRegionFromDraft(
  f: RenderableFrame,
  draft: ResizeDraft,
  view: ViewState,
  // fromCanvas/unproject are injected so this stays a pure function of its inputs
  // and testable; SkyMap passes the projection helpers.
  fromCanvas: (x: number, y: number, view: ViewState) => { x: number; y: number },
  unproject: (x: number, y: number) => { ra: number; dec: number },
): FovFrameResizeRegion {
  const geo = frameGeometry(f, view);
  // Px → degrees via the frame's own tile size (avoids re-inverting the projection).
  const wDeg = f.wDeg * (draft.halfW / Math.max(1e-6, geo.halfW));
  const hDeg = f.hDeg * (draft.halfH / Math.max(1e-6, geo.halfH));
  const proj = fromCanvas(draft.cx, draft.cy, view);
  const { ra, dec } = unproject(proj.x, proj.y);
  // PA that reproduces the frame's on-screen orientation at the new centre
  // (works whether the frame was sky- or screen-anchored).
  const paDeg = canvasRotDegToPa(geo.rotDeg, ra, dec, view);
  return { centerRa: ra, centerDec: dec, wDeg, hDeg, paDeg };
}
