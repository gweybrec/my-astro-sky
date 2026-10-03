/**
 * Shared sky-map types.
 *
 * These live in their own module (rather than in `sky-map.ts`) so that frame
 * geometry, the frame stores, the overlays and their tests can reference the
 * shapes without importing the `SkyMap` canvas class — which pulls in the whole
 * render stack and forced test files to stub it out with `vi.mock`.
 *
 * `sky-map.ts` re-exports everything here, so existing import sites keep working.
 */
import type { Star, DSO } from './types';
import type { HorizonSummit } from './horizon-io';
import type { SmartMosaicEnvelope } from './mosaic';

/** FOV frame specification stored in angular dimensions (computed to canvas px at render time). */
export interface FovFrameSpec {
  label: string;
  wDeg: number;
  hDeg: number;
}

/**
 * An independent, interactive FOV frame instance. Unlike {@link FovFrameSpec}
 * (legacy, viewport-centred, single global rotation), each instance carries its
 * own anchor and rotation and only the `active` one is manipulable. The anchor
 * and rotation are resolved to canvas pixels at render time (they depend on the
 * live view).
 */
export interface RenderableFrame {
  id: string;
  /** Plain setup name — drawn on the map frame. */
  name: string;
  /** Setup name + FOV size — shown in the frame-manager list. */
  label: string;
  wDeg: number;
  hDeg: number;
  /** Only the active frame shows handles and can be moved/rotated. */
  active: boolean;
  /** Free frames can be hidden from the map via the manager checkbox (default visible). */
  visible?: boolean;
  /** Whether the frame can be dragged to a new position (ad-hoc + plan frames). */
  movable: boolean;
  /**
   * Whether the frame can be toggled between floating (screen) and pinned (sky)
   * via the on-canvas pushpin glyph. Ad-hoc frames are pinnable; plan frames are
   * always sky-anchored and derive their target from content, so they are not.
   */
  pinnable?: boolean;
  /**
   * When pinning/dragging a pinnable frame, whether to snap to the nearest DSO
   * (the persistent per-frame "anchor" toggle). Defaults to true (legacy
   * behaviour); false pins exactly where the frame sits.
   */
  anchorSnap?: boolean;
  /** Target DSO id for a plan frame (may be null for a custom location). */
  dsoId?: string | null;
  /**
   * Plan frames re-derive their target from the DSOs inside the frame on move
   * (keep original if still framed, else closest-to-centre, else custom); ad-hoc
   * frames snap to the single nearest DSO instead.
   */
  derivesTargetFromContent?: boolean;
  anchorKind: 'screen' | 'sky';
  /** Floating anchor: normalised viewport coords [0..1]. */
  nx?: number;
  ny?: number;
  /** Pinned anchor: sky coordinates (degrees). */
  ra?: number;
  dec?: number;
  /** Display name of the pinned DSO (for the frame-manager list), if any. */
  anchorLabel?: string | null;
  /** Position angle (°E of N) for pinned frames; null → 0. */
  paDeg?: number | null;
  /** Screen rotation (deg) for floating frames. */
  screenRotationDeg?: number;
  /**
   * Mosaic this frame is a tile of, or null/undefined for a standalone frame.
   * Tiles of one mosaic render as a group (no per-tile label/handles) with a
   * single bounding outline; they are not individually selectable in Phase 1.
   */
  mosaicId?: string | null;
  /** True when this tile has at least one free neighbor (no adjacent tile on that
   * side). Only border tiles show the delete button; inner tiles surrounded on all
   * 4 sides cannot be deleted individually. */
  mosaicIsBorderTile?: boolean;
  /**
   * Whether the frame shows corner resize handles: dragging a corner extends the
   * frame into a mosaic that covers the new region. Set for standalone plan
   * frames (which can become a plan mosaic).
   */
  resizable?: boolean;
  /**
   * Set on a smart-telescope frame: a resize enlarges this single frame within
   * the envelope (rather than tiling a grid). Holds the size limits and the
   * native FOV so the drag preview can clamp live. Null/absent for normal scopes.
   */
  smartMosaic?: { env: SmartMosaicEnvelope; nativeWDeg: number; nativeHDeg: number } | null;
  /** True on the single outline frame that represents a whole mosaic (selectable,
   * movable, rotatable, resizable); its tiles carry `mosaicId` instead. */
  isMosaicOutline?: boolean;
}

/** Region (sky terms) produced by a drag-to-extend gesture on a frame. */
export interface FovFrameResizeRegion {
  centerRa: number;
  centerDec: number;
  wDeg: number;
  hDeg: number;
  paDeg: number;
}

/** Change emitted when the user moves/rotates/pins an interactive frame. */
export interface FovFrameChange {
  anchor?:
    | { kind: 'screen'; nx: number; ny: number }
    | { kind: 'sky'; ra: number; dec: number; dsoId: string | null };
  /** New position angle (°E of N) — emitted when a pinned frame is rotated. */
  paDeg?: number;
  /** New screen rotation (deg) — emitted when a floating frame is rotated. */
  screenRotationDeg?: number;
}

/**
 * Observer/time parameters for one rendered frame: local sidereal time (hours)
 * and observer latitude (degrees). Null wherever date mode is off or no observer
 * location is set — see `SkyMap.computeHorizonParams()`.
 */
export interface HorizonParams {
  lstH: number;
  latDeg: number;
}

/** A point on the observer's local sky, in horizontal (Alt/Az) coordinates. */
export interface AltAzPoint {
  azDeg: number;
  altDeg: number;
}

export type StarHoverCallback = (star: Star | null, x: number, y: number) => void;
export type DSOHoverCallback = (dso: DSO | null, x: number, y: number) => void;
export type SummitHoverCallback = (summit: HorizonSummit | null, x: number, y: number) => void;
export type StarPickedCallback = (star: Star) => void;

/**
 * Why a view-change notification fired.
 *
 * - `'view'` — the user (or code) moved the view itself: pan, zoom, rotate, resize,
 *   hemisphere/local-sky switch. Anything anchored to a screen position is now stale.
 * - `'skyClock'` — the view is untouched; only the simulated clock advanced, which
 *   re-derives the zenith projection in local-sky mode so the sky rotates underneath
 *   a fixed view. Listeners must refresh what they draw, but must NOT treat this as a
 *   user gesture (dismissing a hover tooltip once a second, for one).
 */
export type ViewChangeReason = 'view' | 'skyClock';

export type ViewChangeCallback = (reason: ViewChangeReason) => void;

/** Normalise a rotation to the (−180, 180] range. */
export function normalizeRotationDeg(deg: number): number {
  let normalized = ((deg % 360) + 360) % 360;
  if (normalized > 180) normalized -= 360;
  return normalized;
}
