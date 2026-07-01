import type { Star, DSO, ViewState, Point, ConstellationStyle } from './types';
import { project, projectCached, getProjectionGeneration, toCanvas, fromCanvas, unproject, setHemisphere, getHemisphere, fitScaleForBorderCircle, borderRadiusPU, getProjectionMode } from './projection';
import { framePointToSky, clampSmartMosaicSize } from './mosaic';
import type { SmartMosaicEnvelope } from './mosaic';
import { getStars, getStarMagsSorted, getConstellationLines, getConstellationInfos, loadConstellationStyle, normalizeRA } from './star-catalog';
import { getDSOs, getDSOById } from './dso-catalog';
import { selectDSOsToRender, DSO_CONTAINER_VISIBLE_RADIUS_PX, type SelectableDSO } from './dso-selection';
import {
  targetRenderCount, magThresholdForCount,
  STAR_DENSITY_K, DSO_DENSITY_K, MIN_BUDGET_MULT,
} from './render-budget';
import { DSO_DENSITY_MAX } from './density-slider';
import { frameTargetDso } from './fov-frame-target';
import { SpatialIndex } from './spatial-index';
import { paToCanvasRotationDeg, canvasRotationToPaDeg } from './frame-orientation';
import {
  isNearPolygonBorder,
  isNearHandle,
  rotateHandlePos,
  canvasRotationDegFromCursor,
  resizeFromCorner,
  convexPolygonsOverlap,
} from './fov-frame-geometry';
import pinSvgRaw from './icons/pin.svg?raw';
import { computeFovTargetScale } from './gear-presets';
import { SKY_THEME, applyStarColor } from './sky-themes';

const DEG2RAD = Math.PI / 180;

/** Pushpin glyph path (24×24 box) extracted from the shared icon asset. */
const PIN_PATH_D = pinSvgRaw.match(/\bd="([^"]+)"/)?.[1] ?? '';
/** Lazily-built Path2D for the pushpin glyph. Lazy so module load does not
 * require a DOM (Path2D is absent in the unit-test environment). */
let pinPath2D: Path2D | null = null;
function getPinPath(): Path2D {
  return (pinPath2D ??= new Path2D(PIN_PATH_D));
}

/** Trash glyph (24×24 box), built from the shared trash icon's subpaths. Stroked. */
const TRASH_PATHS_D = ['M3 6L5 6L21 6', 'M19 6l-1 14H6L5 6', 'M10 11v6M14 11v6', 'M9 6V4h6v2'];
let trashPath2D: Path2D | null = null;
function getTrashPath(): Path2D {
  if (trashPath2D) return trashPath2D;
  const p = new Path2D();
  for (const d of TRASH_PATHS_D) p.addPath(new Path2D(d));
  return (trashPath2D = p);
}

/** Returns true if (px, py) is inside the convex polygon defined by pts (winding order irrelevant). */
function pointInConvexPolygon(px: number, py: number, pts: Point[]): boolean {
  const n = pts.length;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const cross = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x);
    if (cross === 0) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (sign !== s) return false;
  }
  return sign !== 0;
}

export interface PhotoOutline {
  name: string;
  corners: Point[];
}

/**
 * Returns 0 or 1: the index of the longer of the two adjacent edges of a
 * rectangular quad. Only two edges need checking since opposite sides are equal.
 */
export function photoLabelEdgeIndex(corners: Point[]): 0 | 1 {
  const len0 = Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y);
  const len1 = Math.hypot(corners[2].x - corners[1].x, corners[2].y - corners[1].y);
  return len1 > len0 ? 1 : 0;
}

/**
 * Returns the canvas anchor point and rotation angle to render a label along
 * the given edge, flipping direction when the raw angle would be upside-down.
 */
export function photoLabelTransform(
  corners: Point[],
  edgeIdx: 0 | 1,
): { x: number; y: number; angle: number } {
  const p0 = corners[edgeIdx];
  const p1 = corners[(edgeIdx + 1) % corners.length];
  const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
  if (angle > Math.PI / 2 || angle < -Math.PI / 2) {
    // Flip and normalize so the result stays in [-π/2, π/2]
    const flipped = angle + Math.PI;
    return { x: p1.x, y: p1.y, angle: flipped > Math.PI ? flipped - 2 * Math.PI : flipped };
  }
  return { x: p0.x, y: p0.y, angle };
}

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
 * Rotates a rectangle of half-dimensions (halfWPx × halfHPx) centred at (cx, cy)
 * by rotationDeg and returns the 4 corners clockwise from top-left.
 */
export function computeFovFrameCorners(
  halfWPx: number,
  halfHPx: number,
  cx: number,
  cy: number,
  rotationDeg: number,
): Point[] {
  const angle = rotationDeg * DEG2RAD;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const raw: Point[] = [
    { x: -halfWPx, y: -halfHPx },
    { x:  halfWPx, y: -halfHPx },
    { x:  halfWPx, y:  halfHPx },
    { x: -halfWPx, y:  halfHPx },
  ];
  return raw.map(p => ({
    x: cx + p.x * cosA - p.y * sinA,
    y: cy + p.x * sinA + p.y * cosA,
  }));
}

export function findTopPhotoOutlineAtPoint(px: number, py: number, outlines: PhotoOutline[]): string | null {
  for (let i = outlines.length - 1; i >= 0; i--) {
    if (pointInConvexPolygon(px, py, outlines[i].corners)) {
      return outlines[i].name;
    }
  }
  return null;
}

function bvToRgb(bv: number): [number, number, number] {
  bv = Math.max(-0.4, Math.min(2.0, bv));

  let r: number, g: number, b: number;

  if (bv < 0.4) {
    // Hot stars: neutral white at the white point (B-V ≈ 0.4), increasingly
    // blue toward B-V = -0.4. This makes B/A-type stars (Rigel, Vega) read as
    // proper blue-white instead of pure white.
    const t = (0.4 - bv) / 0.8; // 0 at bv=0.4, 1 at bv=-0.4
    r = 1.0 - 0.45 * t;
    g = 1.0 - 0.17 * t;
    b = 1.0;
  } else if (bv < 0.8) {
    const t = (bv - 0.4) / 0.4;
    r = 1.0;
    g = 1.0 - 0.12 * t;
    b = 1.0 - 0.32 * t;
  } else if (bv < 1.2) {
    const t = (bv - 0.8) / 0.4;
    r = 1.0;
    g = 0.88 - 0.13 * t;
    b = 0.68 - 0.20 * t;
  } else {
    const t = Math.min((bv - 1.2) / 0.8, 1);
    r = 1.0;
    g = 0.75 - 0.13 * t;
    b = 0.48 - 0.16 * t;
  }

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/** How much stars may grow when zooming in, like looking through a telescope. */
const STAR_ZOOM_CAP = 2.2;

function starRadius(mag: number, scale: number, brightZoomBoost = 0): number {
  const base = Math.max(0.5, 3.5 - mag * 0.5);
  // Stars grow when zooming in (telescope-like), up to a cap so they don't take
  // over the view. Bright stars (mag < 3) get a higher cap so they stay prominent
  // when zoomed in (Stellarium-like); the brightest grow the most.
  const cap = STAR_ZOOM_CAP + (mag < 3 ? (3 - mag) * brightZoomBoost : 0);
  const zoomFactor = Math.min(cap, Math.sqrt(scale / 400));
  return Math.max(1.5, base * zoomFactor);
}

function computeMaxMag(scale: number): number {
  const raw = 6 + Math.log2(scale / 200);
  return Math.max(6, raw);
}

// Snap a zoom scale to a ~6% multiplicative grid. The star sprite atlas is keyed on
// this (not the raw scale), so a continuous zoom only rebuilds the atlas when it
// crosses a bucket — a handful of times across the whole range instead of every
// frame. Sprites end up at most ~3% off their exact size mid-zoom (imperceptible in
// motion, snapped exact at bucket boundaries), with no drawImage rescaling.
const ATLAS_SCALE_STEP = Math.log(1.06);
function atlasScaleBucket(scale: number): number {
  return Math.exp(Math.round(Math.log(scale) / ATLAS_SCALE_STEP) * ATLAS_SCALE_STEP);
}

// ─── Star painting (shared by the live draw and the sprite cache) ────────────
// Resolved per-star drawing inputs. Everything here is a pure function of
// (mag, bv, scale, maxMag, theme), so two stars with the same quantized mag/bv
// share one sprite (see renderStars' atlas).
interface StarPaint {
  radius: number;
  r: number; g: number; b: number;   // dot colour
  soft: number;                       // soft-rim fraction of the radius
  glowAlpha: number;
  glowR: number;                      // glow extent in px (0 when no glow)
  coreEdge: number;
  solidUntil: number;
  gr: number; gg: number; gb: number; // glow colour
}

function computeStarPaint(
  mag: number, bv: number, scale: number, maxMag: number,
  theme: typeof SKY_THEME, established = false,
): StarPaint {
  const radius = starRadius(mag, scale, theme.brightZoomBoost) * theme.radiusScale;
  const spectral = bvToRgb(bv);
  const [r, g, b] = applyStarColor(spectral, theme);
  // 1 when well below the limit, ramping to 0 right at it (just-appearing stars).
  const estab = established ? 1 : Math.min(1, Math.max(0, (maxMag - mag) / 1.5));
  const soft = 0.3 + 0.4 * (1 - estab);
  const glowBright = mag < theme.glowThresholdMag
    ? Math.min(1, Math.max(0, (theme.glowThresholdMag - mag) / theme.glowThresholdMag))
    : 0;
  const glowAlpha = theme.glowOpacity * glowBright;
  let glowR = 0, coreEdge = 0, solidUntil = 0, gr = r, gg = g, gb = b;
  if (glowAlpha > 0.01) {
    const glow = applyStarColor(spectral, theme, theme.glowSaturation);
    gr = glow[0]; gg = glow[1]; gb = glow[2];
    const glowZoom = 1 + theme.glowZoomSpread * Math.max(0, Math.min(3, Math.sqrt(scale / 400)) - 1);
    glowR = radius * theme.glowRadiusMul * glowZoom;
    coreEdge = radius / glowR;            // dot edge as a fraction of glowR
    solidUntil = coreEdge * (1 - soft);   // fully opaque out to here
  }
  return { radius, r, g, b, soft, glowAlpha, glowR, coreEdge, solidUntil, gr, gg, gb };
}

/**
 * Paint a single star at (cx, cy). Mirrors the original inline draw exactly: a
 * one-gradient opaque-core→halo for glowing stars, else an opaque core with a soft
 * rim. Used both to fill a sprite (cx=cy=half) and to draw the highlighted star live.
 */
function paintStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, p: StarPaint): void {
  if (p.glowAlpha > 0.01) {
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, p.glowR);
    grad.addColorStop(0, `rgba(${p.r}, ${p.g}, ${p.b}, 1)`);
    grad.addColorStop(p.solidUntil, `rgba(${p.r}, ${p.g}, ${p.b}, 1)`);
    const GLOW_STEPS = 12;
    for (let i = 0; i <= GLOW_STEPS; i++) {
      const f = i / GLOW_STEPS;
      const stop = p.coreEdge + (1 - p.coreEdge) * f;
      const a = p.glowAlpha * Math.pow(1 - f, 2.5);
      grad.addColorStop(stop, `rgba(${p.gr}, ${p.gg}, ${p.gb}, ${a})`);
    }
    ctx.fillStyle = grad;
    ctx.fillRect(cx - p.glowR, cy - p.glowR, p.glowR * 2, p.glowR * 2);
  } else {
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, p.radius);
    grad.addColorStop(0, `rgba(${p.r}, ${p.g}, ${p.b}, 1)`);
    grad.addColorStop(1 - p.soft, `rgba(${p.r}, ${p.g}, ${p.b}, 1)`);
    grad.addColorStop(1, `rgba(${p.r}, ${p.g}, ${p.b}, 0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(cx - p.radius, cy - p.radius, p.radius * 2, p.radius * 2);
  }
}

export function normalizeRotationDeg(deg: number): number {
  let normalized = ((deg % 360) + 360) % 360;
  if (normalized > 180) normalized -= 360;
  return normalized;
}

// ─── DSO rendering helpers ──────────────────────────────────────────────────

/** Convert angular size (arcmin) to canvas pixels accounting for stereographic scale */
function angularSizeToCanvasPx(arcmin: number, decDeg: number, scale: number, cos2?: number): number {
  // cos2 depends only on dec + hemisphere; hot per-DSO callers pass a cached value
  // (see dsoSizeCos2) so the trig runs once per object per hemisphere change instead
  // of 2–3× per object every frame. Same formula either way, so hit-testing (which
  // omits the arg) and rendering stay pixel-identical.
  if (cos2 === undefined) {
    const colatitude = getHemisphere() === 'south' ? 90 + decDeg : 90 - decDeg;
    const theta = colatitude * Math.PI / 180;
    cos2 = Math.cos(theta / 2) ** 2;
  }
  const rad = (arcmin / 60) * Math.PI / 180;
  return (rad / (2 * cos2)) * scale;
}

/**
 * Body-radius threshold (projection units) above which a DSO bypasses the viewport
 * spatial index and is always considered in {@link SkyMap.selectRenderedDSOs}. Keeps
 * the query margin tight for the ~99% of normal objects; ~0.04 PU ≈ a 4.6° radius.
 */
const DSO_GIANT_BODY_PU = 0.04;

/**
 * Cached `cos²((90∓dec)/2)` factor for a DSO's angular-size conversion. Invalidated
 * by the projection generation (hemisphere change), matching the formula in
 * {@link angularSizeToCanvasPx}.
 */
function dsoSizeCos2(dso: DSO): number {
  if (dso._cos2g !== getProjectionGeneration()) {
    const colatitude = getHemisphere() === 'south' ? 90 + dso.dec : 90 - dso.dec;
    const theta = colatitude * Math.PI / 180;
    dso._cos2 = Math.cos(theta / 2) ** 2;
    dso._cos2g = getProjectionGeneration();
  }
  return dso._cos2!;
}

/** Position angle (E of celestial north) → angle on canvas */
function dsoCanvasAngle(pa: number, raDeg: number, viewRotationDeg: number): number {
  const raRad = raDeg * Math.PI / 180;
  const northAngle = Math.atan2(Math.cos(raRad), -Math.sin(raRad));
  return northAngle - pa * Math.PI / 180 + viewRotationDeg * DEG2RAD;
}

export type StarHoverCallback = (star: Star | null, x: number, y: number) => void;
export type DSOHoverCallback = (dso: DSO | null, x: number, y: number) => void;
export type StarPickedCallback = (star: Star) => void;

export class SkyMap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private view: ViewState;
  private onViewChange: (() => void) | null = null;
  private onStarHover: StarHoverCallback | null = null;
  private onDSOHover: DSOHoverCallback | null = null;
  private showDSOs = true;
  private showStars = true;
  private showConstellationLines = true;
  private showConstellationNames = true;
  private constellationStyle: ConstellationStyle = 'western';
  private visibleDSOTypes: Set<string> = new Set(['GxS', 'GxE', 'GxI', 'Gx', 'OC', 'GC', 'EN', 'RN', 'PN', 'SNR', 'DN', '?']);
  private visibleDSOCatalogs: Set<string> = new Set(['M', 'NGC', 'IC', 'SH2']);
  private showGrid = true;
  private showStarLabels = true;
  private showDSOLabels = true;
  private skyOpacity = 0.5;
  private backgroundOpacity = 1.0;
  // The app's single sky theme (background, stars, glow, grid tint).
  private readonly skyTheme = SKY_THEME;

  // ── Star sprite atlas ──────────────────────────────────────────────────────
  // Distinct quantized (mag, bv) sprites pre-rendered for the current zoom. Keyed
  // by an integer bucket; rebuilt only when scale or the mag limit changes, so a
  // pan reuses every sprite instead of rebuilding ~15-stop gradients per star.
  private starSprites = new Map<number, { canvas: HTMLCanvasElement; half: number }>();
  private starSpriteScale = -1;
  private starSpriteMaxMag = -1;

  // ── Hover hit-test throttle ────────────────────────────────────────────────
  // mousemove fires faster than we can draw a tooltip, and the hit-test walks the
  // star/DSO indexes + rebuilds the DSO selection. Coalesce to one test per frame.
  private pendingHover: { mx: number; my: number; clientX: number; clientY: number } | null = null;
  private hoverRaf: number | null = null;
  private maxStarCount = 2000;
  private maxDSOCount = 500;
  // Per-frame cache of the DSO render selection — single source of truth shared by
  // renderDSOs, renderDSOLabels and isDSORendered so drawing and hit-testing agree.
  // Invalidated at the top of render(); rebuilt lazily (e.g. on a hover between frames).
  private cachedSelectedDSOs: DSO[] | null = null;
  private cachedSelectedDSOIds: Set<string> | null = null;
  private highlightedDSO: string | null = null; // ID of DSO to always render
  private highlightedStar: number | null = null; // HIP number of star to highlight
  private photoOutlines: PhotoOutline[] = [];
  private showPhotoOutlines = true;
  private fovFrameSpecs: FovFrameSpec[] = [];
  private fovRotationDeg = 0;

  // Interactive frame instances (independent anchor + rotation, single active).
  private fovInstances: RenderableFrame[] = [];
  private onFovInstanceSelect: ((id: string | null) => void) | null = null;
  private onFovInstanceChange: ((id: string, change: FovFrameChange) => void) | null = null;
  private frameDrag: { id: string; mode: 'move' | 'rotate' | 'resize'; corner?: number } | null = null;
  // Transient rubber-band rectangle shown while a resize drag is in progress.
  private resizeDraft: { cx: number; cy: number; halfW: number; halfH: number; rotDeg: number } | null = null;
  // DSO the active move-drag will snap to on release; drives the elastic overlay.
  private snapCandidate: { id: string; ra: number; dec: number; majAxis: number } | null = null;
  // In-flight snap-back animation after a release within range (requestAnimationFrame handle).
  private snapAnim: { id: string; raf: number } | null = null;
  private onFovFrameResize: ((id: string, region: FovFrameResizeRegion) => void) | null = null;
  // Per-tile delete: clicking a tile's trash button on the selected mosaic.
  private onMosaicTileRemove: ((tileId: string) => void) | null = null;
  // Add-tile: sky positions of the "+" spots around the selected mosaic.
  private mosaicAddCandidates: Array<{ ra: number; dec: number }> = [];
  private onMosaicTileAdd: ((ra: number, dec: number) => void) | null = null;
  // Merge: a standalone frame dropped onto another frame/mosaic of the same plan.
  private onFrameMerge: ((movedId: string, targetId: string) => void) | null = null;

  // Spatial indexes for fast hover detection
  private starIndex = new SpatialIndex<Star>(0.02);
  private dsoIndex = new SpatialIndex<DSO>(0.02);
  private starIndexMaxMag = -1;
  private dsoIndexMaxMag = -99999; // Sentinel value meaning "not initialized"

  // All DSOs indexed by projection position (no mag/filter), for viewport culling in
  // selectRenderedDSOs. Positions change only with the projection generation, so this
  // is rebuilt once per hemisphere/mode change (or DSO coordinate override), not per frame.
  private dsoAllIndex = new SpatialIndex<DSO>(0.02);
  private dsoGiants: DSO[] = [];   // bodies larger than the query margin; always considered
  private dsoAllIndexGen = -1;
  private dsoMaxBodyPU = 0; // largest indexed (non-giant) body radius (projection units)

  // Pan state
  private isPanning = false;
  private panStartX = 0;
  private panStartY = 0;
  private panAnchorProjX = 0;
  private panAnchorProjY = 0;

  // Animation
  private animationId: number | null = null;

  // Coalesced-render frame handle (separate from animationId so navigation/snap
  // animations and render coalescing never clobber each other's rAF handle).
  private _renderRaf: number | null = null;

  // ── Interaction LOD ────────────────────────────────────────────────────────
  // While the user is actively panning/zooming we cap the star/DSO density budget
  // so each frame stays cheap and motion is smooth even with the sliders maxed out.
  // After motion settles, a full-budget redraw fills in the less-important objects
  // (the brightest stars / highest-priority DSOs are always kept, so only the faint
  // background appears "with a bit of delay"). See effectiveStarBudget / markInteracting.
  private interacting = false;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  // Idle delay after the last interactive frame before the full-detail redraw.
  private static readonly SETTLE_MS = 180;
  // During a gesture the frozen star sprite atlas is rebuilt once the live zoom drifts
  // past this radius ratio from it — bounding how much drawImage upscales (and thus
  // pixelates) a frozen sprite, while a continuous zoom rebuilds only once per such
  // step rather than every frame (see renderStars).
  private static readonly ATLAS_REBUILD_RATIO = 1.3;
  // User toggle: when false, the motion LOD is disabled entirely — full detail is drawn
  // while moving (no objects disappear/flicker), at the cost of motion smoothness. Only
  // affects manual density (auto DSO already keeps frames smooth without throttling).
  private motionLOD = true;

  // The interaction cap is NOT a fixed number — it adapts to the machine. We measure
  // each interactive frame's draw time and steer `interactionQuality` (0..1) so frames
  // land near INTERACTION_TARGET_MS: a fast computer ramps the cap up toward the user's
  // full density (q→1, no throttle); a slow one backs off toward the floor. The learned
  // value persists across gestures, so only the first ~handful of frames of the very
  // first pan are spent calibrating. The floors guarantee a usable minimum everywhere.
  private interactionQuality = 0.5;
  private static readonly INTERACTION_STAR_FLOOR = 300;
  private static readonly INTERACTION_DSO_FLOOR = 100;
  // Per-frame draw-time target (ms). ~10ms leaves headroom inside a 16.7ms / 60fps frame.
  private static readonly INTERACTION_TARGET_MS = 10;

  // ── Auto density ────────────────────────────────────────────────────────────
  // Auto mode is the opposite philosophy to the motion LOD above: rather than throttle
  // during motion (which makes objects pop in/out), it sizes the budget so EVERY frame is
  // smooth, and renders that same budget whether moving or still — so nothing pops.
  //   • Stars (autoStarDensity): held at a fixed budget (maxStarCount pinned to
  //     AUTO_STAR_BUDGET by the store) — constellations + bright stars, cheap and constant.
  //   • DSOs (autoDSODensity): the performance lever. Interactive frames (and a one-shot burst
  //     when auto is switched on) are timed and the DSO budget nudged so draw time stays near
  //     AUTO_TARGET_MS. Reported via onAutoDensityChange so the disabled slider tracks it.
  // While DSO-auto is on it absorbs all the cost, so the motion LOD is disabled entirely
  // (see effectiveStarBudget / effectiveDSOBudget). The LOD only applies to a manual axis.
  private autoStarDensity = false;
  private autoDSODensity = false;
  private onAutoDensityChange: ((dso: number) => void) | null = null;
  // One-shot calibration: set true when DSO-auto is switched on so the budget re-tunes
  // immediately (at rest) instead of waiting for the next pan. Cleared once it converges.
  private dsoCalibrating = false;
  // Per-frame draw-time target for the DSO lever. Higher = more DSOs (motion a touch
  // heavier); tuned to favour a fuller map since DSOs are the focus of the app.
  private static readonly AUTO_TARGET_MS = 20;
  private static readonly AUTO_DSO_MIN = 80;

  // Bound event handlers for cleanup
  private boundHandlers: { target: EventTarget; event: string; handler: EventListener }[] = [];

  // Picking mode
  private pickingMode = false;
  private onStarPicked: StarPickedCallback | null = null;

  // Photo click callback
  private onPhotoClick: ((photoName: string) => void) | null = null;

  // DSO click callback
  private hoveredDSO: DSO | null = null;
  private onDSOClick: ((dso: DSO) => void) | null = null;
  // Clear-selection callback: fired on right-click to dismiss the active DSO/star selection.
  private onClearSelection: (() => void) | null = null;
  // One-shot DSO picker: armed by a caller that wants the next DSO click (used
  // to choose a mosaic target). Fires once, alongside the normal click action.
  private onNextDSOPick: ((dso: DSO) => void) | null = null;

  // Interaction control (disabled when another view is active)
  private interactionEnabled = true;

  // Hemisphere & border
  private hemisphere: 'north' | 'south' = 'north';
  private borderLatDeg = 45;

  // Fisheye mode
  private fisheyeMode = false;

  // Overlay canvas — sits above the photo layer in the DOM, used to draw frames on top of photos
  private overlayCanvas: HTMLCanvasElement | null = null;
  private overlayCtx: CanvasRenderingContext2D | null = null;
  // True while renderToCanvas() is active — causes render() to draw frames inline rather than on the overlay
  private _renderingOffscreen = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.view = { centerX: 0, centerY: 0, scale: 0, rotationDeg: 0, width: 0, height: 0 };
    this.setupEvents();
    this.resize();
  }

  setOnViewChange(cb: () => void) {
    this.onViewChange = cb;
  }

  setOnStarHover(cb: StarHoverCallback) {
    this.onStarHover = cb;
  }

  setOnDSOHover(cb: DSOHoverCallback) {
    this.onDSOHover = cb;
  }

  setShowDSOs(show: boolean) {
    this.showDSOs = show;
    this.requestRender();
  }

  setShowStars(show: boolean) { this.showStars = show; this.requestRender(); }
  setShowConstellationLines(show: boolean) { this.showConstellationLines = show; this.requestRender(); }
  setShowConstellationNames(show: boolean) { this.showConstellationNames = show; this.requestRender(); }

  async setConstellationStyle(style: ConstellationStyle): Promise<void> {
    await loadConstellationStyle(style);
    this.constellationStyle = style;
    this.requestRender();
  }

  getConstellationStyle(): ConstellationStyle {
    return this.constellationStyle;
  }

  /** The underlying canvas element. Backing store is devicePixelRatio-scaled (see resize()). */
  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  setOverlayCanvas(canvas: HTMLCanvasElement): void {
    this.overlayCanvas = canvas;
    this.overlayCtx = canvas.getContext('2d')!;
    this.resizeOverlay();
  }

  getOverlayCanvas(): HTMLCanvasElement | null {
    return this.overlayCanvas;
  }
  setMaxStarCount(count: number) { this.maxStarCount = count; this.requestRenderInteractive(); }
  setMaxDSOCount(count: number) { this.maxDSOCount = count; this.requestRenderInteractive(); }
  /** Fix the star budget (constellations + bright stars) and stop motion-throttling it. */
  setAutoStarDensity(v: boolean) { this.autoStarDensity = v; if (v) this.requestRender(); }
  /** Enable/disable performance-driven real-time auto-tuning of the DSO density budget.
   * Enabling kicks off a one-shot calibration so the slider snaps to the right value now. */
  setAutoDSODensity(v: boolean) { this.autoDSODensity = v; if (v) this.dsoCalibrating = true; this.requestRender(); }
  /** Notified with the new DSO budget whenever auto-tuning changes it, so the UI can track it. */
  setOnAutoDensityChange(cb: (dso: number) => void) { this.onAutoDensityChange = cb; }
  /** Enable/disable the motion LOD (detail reduction while panning/zooming). */
  setMotionLOD(v: boolean) { this.motionLOD = v; this.requestRender(); }
  setHighlightedDSO(dsoId: string | null) { this.highlightedDSO = dsoId; this.dsoIndexMaxMag = -99999; this.requestRender(); }
  setHighlightedStar(hip: number | null) { this.highlightedStar = hip; this.starIndexMaxMag = -1; this.requestRender(); }
  setVisibleDSOTypes(types: Set<string>) { this.visibleDSOTypes = types; this.dsoIndexMaxMag = -99999; this.requestRender(); }
  setVisibleDSOCatalogs(catalogs: Set<string>) { this.visibleDSOCatalogs = catalogs; this.dsoIndexMaxMag = -99999; this.requestRender(); }
  setShowGrid(show: boolean) { this.showGrid = show; this.requestRender(); }
  setShowStarLabels(show: boolean) { this.showStarLabels = show; this.requestRender(); }
  setShowDSOLabels(show: boolean) { this.showDSOLabels = show; this.requestRender(); }
  setSkyOpacity(v: number) { this.skyOpacity = v; this.requestRender(); }
  setBackgroundOpacity(v: number) { this.backgroundOpacity = v; this.requestRender(); }
  setPhotoOutlines(outlines: PhotoOutline[]) { this.photoOutlines = outlines; }
  setShowPhotoOutlines(show: boolean) { this.showPhotoOutlines = show; this.requestRender(); }
  setFovFrames(frames: FovFrameSpec[]) { this.fovFrameSpecs = frames; this.requestRender(); }
  setFovRotationDeg(deg: number) { this.fovRotationDeg = deg; this.requestRender(); }

  /** Replace the interactive frame instances and re-render. */
  setFovInstances(frames: RenderableFrame[]) { this.fovInstances = frames; this.requestRender(); }
  /** Current interactive frame instances (for save/restore around off-screen renders). */
  getFovInstances(): RenderableFrame[] { return this.fovInstances; }
  setOnFovInstanceSelect(cb: (id: string | null) => void) { this.onFovInstanceSelect = cb; }
  setOnFovInstanceChange(cb: (id: string, change: FovFrameChange) => void) { this.onFovInstanceChange = cb; }
  setOnFovFrameResize(cb: (id: string, region: FovFrameResizeRegion) => void) { this.onFovFrameResize = cb; }
  setOnMosaicTileRemove(cb: (tileId: string) => void) { this.onMosaicTileRemove = cb; }
  setOnMosaicTileAdd(cb: (ra: number, dec: number) => void) { this.onMosaicTileAdd = cb; }
  setMosaicAddCandidates(c: Array<{ ra: number; dec: number }>) { this.mosaicAddCandidates = c; this.requestRender(); }
  setOnFrameMerge(cb: (movedId: string, targetId: string) => void) { this.onFrameMerge = cb; }
  setOnPhotoClick(cb: (photoName: string) => void) { this.onPhotoClick = cb; }
  setOnDSOClick(cb: (dso: DSO) => void) { this.onDSOClick = cb; }
  setOnClearSelection(cb: () => void) { this.onClearSelection = cb; }

  /** The currently selected/highlighted DSO id on the map, or null. */
  getHighlightedDSOId(): string | null { return this.highlightedDSO; }
  /** Arm a one-shot picker: the next DSO the user clicks is passed to `cb` (in
   * addition to the normal selection action). Used to choose a mosaic target. */
  armDSOPick(cb: (dso: DSO) => void) { this.onNextDSOPick = cb; }
  /** Cancel a pending one-shot DSO pick (e.g. the user dismissed the prompt). */
  cancelDSOPick() { this.onNextDSOPick = null; }

  /** Switch hemisphere, reset view to pole origin at fit-equator scale, and redraw. */
  setHemisphere(h: 'north' | 'south', borderLatDeg?: number) {
    this.hemisphere = h;
    if (borderLatDeg !== undefined) this.borderLatDeg = borderLatDeg;
    setHemisphere(h);
    // Reset spatial indexes (projection coords change)
    this.starIndexMaxMag = -1;
    this.dsoIndexMaxMag = -99999;
    // Re-center on the new pole (projection origin) and fit equator
    this.cancelAnimation();
    this.view.centerX = 0;
    this.view.centerY = 0;
    if (this.view.width > 0) {
      this.view.scale = Math.min(this.view.width, this.view.height) / 2.2;
    }
    this.onViewChange?.();
    this.requestRender();
  }

  /** Update just the border latitude without switching hemisphere. */
  setBorderLatDeg(deg: number) {
    this.borderLatDeg = deg;
    // Invalidate spatial indexes so border check on hover stays consistent
    this.starIndexMaxMag = -1;
    this.dsoIndexMaxMag = -99999;
    this.requestRender();
  }

  /** Switch to/from fisheye (azimuthal equidistant, zenith-centred) projection. */
  setFisheyeMode(v: boolean) {
    this.fisheyeMode = v;
    this.invalidateSpatialIndexes();
    this.cancelAnimation();
    // Re-centre on zenith origin and fit the horizon circle in the view
    this.view.centerX = 0;
    this.view.centerY = 0;
    this.view.rotationDeg = 0;
    if (this.view.width > 0) {
      this.view.scale = Math.min(this.view.width, this.view.height) / 2 * 0.90;
    }
    this.onViewChange?.();
    this.requestRender();
  }

  /** Invalidate spatial indexes so they are rebuilt on the next render. */
  invalidateSpatialIndexes() {
    this.starIndexMaxMag = -1;
    this.dsoIndexMaxMag = -99999;
  }

  zoomBy(factor: number) {
    this.view.scale = Math.max(50, Math.min(100000, this.view.scale * factor));
    this.onViewChange?.();
    this.requestRenderInteractive();
  }

  rotateByDeg(deltaDeg: number) {
    this.setRotationDeg(this.view.rotationDeg + deltaDeg);
  }

  setRotationDeg(rotationDeg: number) {
    this.view.rotationDeg = normalizeRotationDeg(rotationDeg);
    this.onViewChange?.();
    this.requestRenderInteractive();
  }

  resetRotation() {
    this.setRotationDeg(0);
  }

  panBy(dxPx: number, dyPx: number) {
    this.view.centerX += dxPx / this.view.scale;
    this.view.centerY -= dyPx / this.view.scale;
    this.onViewChange?.();
    this.requestRender();
  }

  getShowGrid() { return this.showGrid; }
  /**
   * Effective star magnitude cutoff for the current zoom + canvas. A star renders iff
   * `star.mag <= this`. Two limits, both pan-invariant, combined by taking the brighter:
   *
   *   - the zoom magnitude gate `computeMaxMag(scale)` — a sane faint-limit curve;
   *   - the density budget: the magnitude of the budget-th brightest star, derived from
   *     the "star density" slider and the zoom/canvas (see render-budget.ts).
   *
   * Both depend only on zoom + canvas, never on what else is on screen, so stars never
   * pop into a screen region that stays put while panning. The density budget replaces
   * both the old viewport-relative top-N cap (which caused the popping) and the old
   * manual "max magnitude" / "auto magnitude" controls.
   */
  private starMagThreshold(): number {
    const { scale, width, height } = this.view;
    const mags = getStarMagsSorted();
    // Upper bound is the catalog length, not an artificial cap: on-screen count is
    // already bounded by the field of view, so when zoomed in the magnitude gate below
    // (not a count cap) decides how faint we go.
    const budget = this.effectiveStarBudget();
    const count = targetRenderCount(
      budget, scale, width, height, STAR_DENSITY_K,
      budget * MIN_BUDGET_MULT, mags.length,
    );
    const densityMag = magThresholdForCount(mags, count);
    return Math.min(computeMaxMag(scale), densityMag);
  }

  /**
   * Pan-invariant DSO priority cutoff for the current zoom + canvas. A DSO renders iff
   * `dso.priority < this` (priority is a dense global blue-noise rank, lower = drawn
   * first). Independent of pan, mirroring {@link starMagThreshold}.
   */
  private dsoPriorityThreshold(): number {
    const { scale, width, height } = this.view;
    // Upper bound is the DSO catalog size; the per-DSO magnitude gate (dsoMaxMag) and
    // the field of view bound how many actually draw when zoomed in.
    const budget = this.effectiveDSOBudget();
    return targetRenderCount(
      budget, scale, width, height, DSO_DENSITY_K,
      budget * MIN_BUDGET_MULT, getDSOs().length,
    );
  }

  private cancelAnimation() {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  navigateTo(ra: number, dec: number, targetScale = 600, animate = true) {
    const target = project(ra, dec);

    if (!animate) {
      this.cancelAnimation();
      this.view.centerX = target.x;
      this.view.centerY = target.y;
      this.view.scale = targetScale;
      this.onViewChange?.();
      this.render();
      return;
    }

    this.cancelAnimation();

    const startX = this.view.centerX;
    const startY = this.view.centerY;
    const startScale = this.view.scale;
    const startTime = performance.now();

    // Adaptive duration based on distance and zoom ratio
    const dx = target.x - startX;
    const dy = target.y - startY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const viewExtent = Math.max(this.view.width, this.view.height) / startScale;
    const normalizedDist = Math.min(dist / Math.max(viewExtent, 0.001), 1);
    const zoomRatio = Math.max(targetScale / startScale, startScale / targetScale);
    const duration = Math.max(300, Math.min(1200,
      300 + normalizedDist * 600 + Math.log2(Math.max(1, zoomRatio)) * 200
    ));

    const step = (now: number) => {
      let t = (now - startTime) / duration;
      if (t >= 1) {
        t = 1;
        this.animationId = null;
      }

      // easeInOutCubic
      const ease = t < 0.5
        ? 4 * t * t * t
        : 1 - Math.pow(-2 * t + 2, 3) / 2;

      this.view.centerX = startX + (target.x - startX) * ease;
      this.view.centerY = startY + (target.y - startY) * ease;
      this.view.scale = startScale + (targetScale - startScale) * ease;

      this.onViewChange?.();
      if (t < 1) {
        // Reduced budget for smooth flight; markInteracting also arms the settle
        // timer so the flag self-clears even if the animation is interrupted.
        this.markInteracting();
        this.render();
        this.animationId = requestAnimationFrame(step);
      } else {
        // Final frame: clear interaction state and paint full detail immediately.
        if (this.settleTimer !== null) { clearTimeout(this.settleTimer); this.settleTimer = null; }
        this.interacting = false;
        this.render();
      }
    };

    this.animationId = requestAnimationFrame(step);
  }

  getView(): ViewState {
    return { ...this.view };
  }

  /**
   * A view that frames the entire border circle into a cssW × cssH frame,
   * keeping the current rotation. Used by the "full sky map" export.
   */
  getFullMapView(cssW: number, cssH: number): ViewState {
    return {
      centerX: 0,
      centerY: 0,
      scale: fitScaleForBorderCircle(cssW, cssH, this.borderLatDeg),
      rotationDeg: this.view.rotationDeg,
      width: cssW,
      height: cssH,
    };
  }

  /**
   * Render the map at an arbitrary view into a target canvas, without touching
   * the live canvas/view. The target backing store must be sized
   * `view.width * pixelScale` × `view.height * pixelScale`. Used by the export
   * feature to re-render the full sky map off-screen.
   */
  renderToCanvas(
    target: HTMLCanvasElement,
    view: ViewState,
    pixelScale: number,
    layers?: Partial<{
      showStars: boolean;
      showDSOs: boolean;
      showConstellationLines: boolean;
      showConstellationNames: boolean;
      showGrid: boolean;
      showStarLabels: boolean;
      showDSOLabels: boolean;
    }>,
  ): void {
    const tctx = target.getContext('2d');
    if (!tctx) return;
    const savedCtx = this.ctx;
    const savedView = this.view;
    // Snapshot any layer flags we may override, so we can restore them exactly.
    const savedLayers = {
      showStars: this.showStars,
      showDSOs: this.showDSOs,
      showConstellationLines: this.showConstellationLines,
      showConstellationNames: this.showConstellationNames,
      showGrid: this.showGrid,
      showStarLabels: this.showStarLabels,
      showDSOLabels: this.showDSOLabels,
    };
    this.ctx = tctx;
    this.view = view;
    this._renderingOffscreen = true;
    if (layers) Object.assign(this, layers);
    tctx.save();
    tctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
    try {
      this.render();
    } finally {
      tctx.restore();
      this._renderingOffscreen = false;
      this.ctx = savedCtx;
      this.view = savedView;
      if (layers) Object.assign(this, savedLayers);
    }
  }

  /** Current FOV frame rotation in degrees (screen-relative). */
  getFovRotationDeg(): number { return this.fovRotationDeg; }

  /** Current FOV frame specs (for save/restore around off-screen renders). */
  getFovFrames(): FovFrameSpec[] { return this.fovFrameSpecs; }

  enterPickingMode(callback: StarPickedCallback) {
    this.pickingMode = true;
    this.onStarPicked = callback;
    this.canvas.style.cursor = 'crosshair';
  }

  exitPickingMode() {
    this.pickingMode = false;
    this.onStarPicked = null;
    this.canvas.style.cursor = 'default';
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.view.width = rect.width;
    this.view.height = rect.height;

    // Default scale: fit equator circle in view
    if (this.view.scale === 0) {
      this.view.scale = Math.min(rect.width, rect.height) / 2.2;
    }

    this.resizeOverlay();
    this.onViewChange?.();
    this.requestRender();
  }

  private resizeOverlay(): void {
    if (!this.overlayCanvas || !this.overlayCtx) return;
    this.overlayCanvas.width = this.canvas.width;
    this.overlayCanvas.height = this.canvas.height;
    const dpr = window.devicePixelRatio || 1;
    this.overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private buildStarIndex(maxMag: number) {
    if (maxMag === this.starIndexMaxMag) return;
    this.starIndexMaxMag = maxMag;
    this.starIndex.clear();
    for (const star of getStars()) {
      if (star.mag > maxMag) continue;
      projectCached(star);
      this.starIndex.insert(star, star._px!, star._py!);
    }
  }

  private buildDSOIndex(maxMag: number | null) {
    // Convert maxMag to a cache key (null becomes -999 for different behavior than computed values)
    const cacheKey = maxMag === null ? -999 : maxMag;
    if (cacheKey === this.dsoIndexMaxMag) return;
    this.dsoIndexMaxMag = cacheKey;
    this.dsoIndex.clear();
    for (const dso of getDSOs()) {
      const isHighlighted = this.highlightedDSO === dso.id;
      
      if (!isHighlighted) {
        if (!this.visibleDSOTypes.has(dso.type)) continue;
        const cat = dso.catalog;
        if (cat && !this.visibleDSOCatalogs.has(cat)) continue;
        if (maxMag !== null && dso.mag !== null && dso.mag > maxMag) continue;
        if (dso.mag === null && maxMag !== null) continue;
      }

      projectCached(dso);
      this.dsoIndex.insert(dso, dso._px!, dso._py!);
    }
  }

  private findClosestStar(mx: number, my: number): Star | null {
    // Match the renderer's magnitude gate so the hover index is a superset of what is
    // drawn (isStarRendered does the final confirm).
    const maxMag = this.starMagThreshold();
    this.buildStarIndex(maxMag);
    const projPt = fromCanvas(mx, my, this.view);
    const threshold = 8 / this.view.scale;
    return this.starIndex.findNearest(projPt.x, projPt.y, threshold);
  }

  private addEvent(target: EventTarget, event: string, handler: EventListener, options?: AddEventListenerOptions) {
    target.addEventListener(event, handler, options);
    this.boundHandlers.push({ target, event, handler });
  }

  private setupEvents() {
    // Zoom with mouse wheel
    this.addEvent(this.canvas, 'wheel', ((e: WheelEvent) => {
      e.preventDefault();
      this.cancelAnimation();
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      // Get projection coords under mouse before zoom
      const before = fromCanvas(mx, my, this.view);

      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      this.view.scale = Math.max(50, Math.min(1000000, this.view.scale * factor));

      // Keep the same projection point anchored under the cursor after zoom.
      const after = fromCanvas(mx, my, this.view);
      this.view.centerX += before.x - after.x;
      this.view.centerY += before.y - after.y;

      this.onViewChange?.();
      this.requestRenderInteractive();
    }) as EventListener, { passive: false });

    // Pan with mouse drag
    this.addEvent(this.canvas, 'mousedown', ((e: MouseEvent) => {
      this.cancelAnimation();
      if (e.button === 0) {
        const rectF = this.canvas.getBoundingClientRect();
        if (this.handleFrameMouseDown(e.clientX - rectF.left, e.clientY - rectF.top)) {
          // A frame grab can start right over a DSO/star (e.g. the centre move
          // dot sits on the DSO inside the frame), so hide any hover tooltip.
          this.dismissTooltip();
          return; // frame interaction consumed the press — no pan
        }
        this.isPanning = true;
        this.panStartX = e.clientX;
        this.panStartY = e.clientY;
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const anchor = fromCanvas(mx, my, this.view);
        this.panAnchorProjX = anchor.x;
        this.panAnchorProjY = anchor.y;
        if (!this.pickingMode) {
          this.canvas.style.cursor = 'grabbing';
        }
      }
    }) as EventListener);

    // Right-click clears the active DSO/star selection (and suppresses the
    // browser context menu when there was something to clear).
    this.addEvent(this.canvas, 'contextmenu', ((e: MouseEvent) => {
      if (this.highlightedDSO === null && this.highlightedStar === null) return;
      e.preventDefault();
      this.onClearSelection?.();
    }) as EventListener);

    this.addEvent(window, 'mousemove', ((e: MouseEvent) => {
      if (this.frameDrag) {
        const rect = this.canvas.getBoundingClientRect();
        this.handleFrameDragMove(e.clientX - rect.left, e.clientY - rect.top);
        return;
      }
      if (this.isPanning) {
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const now = fromCanvas(mx, my, this.view);
        this.view.centerX += this.panAnchorProjX - now.x;
        this.view.centerY += this.panAnchorProjY - now.y;
        this.onViewChange?.();
        this.requestRenderInteractive();
      } else {
        if (!this.interactionEnabled) return;
        // Cursor is over the (now-interactive) tooltip: leave it as-is so the
        // user can move into it to select/copy without it hiding.
        if ((e.target as HTMLElement)?.closest?.('#tooltip')) return;
        // Hover detection
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        // Check if mouse is over the side panel by checking if it's on the right side
        const sidePanel = document.getElementById('side-panel');
        const isOverPanel = sidePanel && !sidePanel.classList.contains('collapsed') && 
                            e.clientX > window.innerWidth - 280; // Panel is 280px wide on the right

        if (mx >= 0 && my >= 0 && mx <= this.view.width && my <= this.view.height && !isOverPanel) {
          this.requestHover(mx, my, e.clientX, e.clientY);
        } else if (isOverPanel) {
          // Hide tooltips when mouse is over side panel
          if (this.onStarHover) {
            this.onStarHover(null, e.clientX, e.clientY);
          }
        }
      }
    }) as EventListener);

    this.addEvent(window, 'mouseup', ((e: MouseEvent) => {
      if (this.frameDrag) {
        const drag = this.frameDrag;
        this.frameDrag = null;
        const snap = this.snapCandidate;
        this.snapCandidate = null;
        if (drag.mode === 'resize') this.finalizeResize(drag.id);
        else if (drag.mode === 'move') {
          // Release within snap range: spring the frame to the DSO centre.
          if (snap) this.animateSnapToDso(drag.id, snap);
          // A standalone frame dropped onto another frame/mosaic of the same plan merges.
          else if (drag.id.startsWith('plan:')) this.checkFrameMerge(drag.id);
        }
        this.render();
        return;
      }
      if (this.isPanning) {
        const dx = e.clientX - this.panStartX;
        const dy = e.clientY - this.panStartY;
        const moved = Math.abs(dx) + Math.abs(dy) > 3;

        this.isPanning = false;
        this.canvas.style.cursor = this.pickingMode ? 'crosshair' : 'default';

        // Picking mode: click (not drag) selects star
        if (this.pickingMode && !moved && this.onStarPicked) {
          const rect = this.canvas.getBoundingClientRect();
          const mx = e.clientX - rect.left;
          const my = e.clientY - rect.top;
          const star = this.findClosestStar(mx, my);
          if (star) {
            this.onStarPicked(star);
          }
        }

        // Photo click: test if click lands inside a photo outline
        if (!this.pickingMode && !moved && this.onPhotoClick) {
          const rect = this.canvas.getBoundingClientRect();
          const mx = e.clientX - rect.left;
          const my = e.clientY - rect.top;
          const photoName = findTopPhotoOutlineAtPoint(mx, my, this.photoOutlines);
          if (photoName) {
            this.onPhotoClick(photoName);
          }
        }

        // DSO click: fire alongside photo click if a DSO is under the cursor.
        if (!this.pickingMode && !moved && this.hoveredDSO) {
          this.onDSOClick?.(this.hoveredDSO);
          // A one-shot picker (e.g. choosing a mosaic target) fires after the
          // normal selection so the click still selects the DSO as usual.
          if (this.onNextDSOPick) {
            const cb = this.onNextDSOPick;
            this.onNextDSOPick = null;
            cb(this.hoveredDSO);
          }
        }
      }
    }) as EventListener);

    // Escape exits picking mode, or deselects the active frame.
    this.addEvent(window, 'keydown', ((e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (this.pickingMode) {
        this.exitPickingMode();
      } else if (this.fovInstances.some(f => f.active)) {
        // Abandon any in-progress snap drag/animation so deselecting can't leave
        // a dangling elastic overlay or running rAF.
        this.frameDrag = null;
        this.snapCandidate = null;
        this.cancelSnapAnim();
        this.selectFrame(null);
        this.render();
      }
    }) as EventListener);
  }

  destroy() {
    this.cancelAnimation();
    this.cancelSnapAnim();
    if (this._renderRaf !== null) {
      cancelAnimationFrame(this._renderRaf);
      this._renderRaf = null;
    }
    if (this.hoverRaf !== null) {
      cancelAnimationFrame(this.hoverRaf);
      this.hoverRaf = null;
    }
    if (this.settleTimer !== null) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
    for (const { target, event, handler } of this.boundHandlers) {
      target.removeEventListener(event, handler);
    }
    this.boundHandlers = [];
  }

  setInteractionEnabled(enabled: boolean): void {
    this.interactionEnabled = enabled;
    if (!enabled) {
      this.dismissTooltip();
    }
  }

  /** Hide any visible hover tooltip (DSO or star) and clear the hovered DSO. */
  private dismissTooltip(): void {
    this.hoveredDSO = null;
    this.onStarHover?.(null, 0, 0);
    this.onDSOHover?.(null, 0, 0);
  }

  private findClosestDSO(mx: number, my: number): DSO | null {
    if (!this.showDSOs) return null;
    // DSOs are gated by priority (not magnitude), so the hit-test index must include all
    // catalog DSOs — a superset of what is drawn; isDSORendered does the precise gating.
    this.buildDSOIndex(null);
    const projPt = fromCanvas(mx, my, this.view);

    // Use a generous threshold to collect all nearby DSO centers.
    // Large DSOs (e.g. M42 at 90') have centers that may be far from the cursor
    // even though the cursor is inside their rendered ellipse.
    const generousThreshold = 200 / this.view.scale;
    const candidates = this.dsoIndex.findAll(projPt.x, projPt.y, generousThreshold);

    if (candidates.length === 0) return null;

    // Among candidates whose rendered ellipse contains the cursor, prefer the smallest.
    // This gives priority to inner/compact objects over large encompassing DSOs.
    const { scale } = this.view;
    const contained: DSO[] = [];
    for (const dso of candidates) {
      const majorArcmin = dso.majAxis ?? 1;
      const rx = Math.max(2, angularSizeToCanvasPx(majorArcmin / 2, dso.dec, scale));
      const dsoProj = project(dso.ra, dso.dec);
      const dsoCanvas = toCanvas(dsoProj.x, dsoProj.y, this.view);
      const dx = dsoCanvas.x - mx;
      const dy = dsoCanvas.y - my;
      const distPx = Math.sqrt(dx * dx + dy * dy);
      if (distPx <= rx) {
        contained.push(dso);
      }
    }

    if (contained.length > 0) {
      // Return the contained DSO with the smallest rendered size
      contained.sort((a, b) => (a.majAxis ?? 1) - (b.majAxis ?? 1));
      return contained[0];
    }

    // Fallback: nearest by center within the original tight threshold
    const tightThreshold = 20 / this.view.scale;
    for (const dso of candidates) {
      const dsoProj = project(dso.ra, dso.dec);
      const dx = dsoProj.x - projPt.x;
      const dy = dsoProj.y - projPt.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= tightThreshold) return dso;
    }

    return null;
  }

  /**
   * DSOs whose centre falls inside the given frame's polygon, sorted by distance
   * to the frame centre (nearest first). Used to derive a plan frame's target
   * after a move. Mag limit matches {@link findClosestDSO}.
   */
  private dsosInFrame(f: RenderableFrame): DSO[] {
    if (!this.showDSOs) return [];
    const maxMag = computeMaxMag(this.view.scale) + 4;
    this.buildDSOIndex(maxMag);

    const { corners, cx, cy, halfW, halfH } = this.frameGeometry(f);
    const projCenter = fromCanvas(cx, cy, this.view);
    // Collect candidates around the frame centre out to its half-diagonal (+margin).
    const radiusPx = Math.hypot(halfW, halfH) + 4;
    const candidates = this.dsoIndex.findAll(projCenter.x, projCenter.y, radiusPx / this.view.scale);

    const inside: Array<{ dso: DSO; dist: number }> = [];
    for (const dso of candidates) {
      const p = project(dso.ra, dso.dec);
      const c = toCanvas(p.x, p.y, this.view);
      if (pointInConvexPolygon(c.x, c.y, corners)) {
        inside.push({ dso, dist: Math.hypot(c.x - cx, c.y - cy) });
      }
    }
    inside.sort((a, b) => a.dist - b.dist);
    return inside.map(e => e.dso);
  }

  /**
   * Check if a star would actually be rendered given current viewport and limits.
   * Replicates the filtering logic from renderStars().
   */
  private isStarRendered(star: Star): boolean {
    const { view } = this;

    // Same pan-invariant magnitude gate as renderStars (highlighted star always shows).
    if (star.hip !== this.highlightedStar && star.mag > this.starMagThreshold()) {
      return false;
    }

    // Check viewport bounds
    const p = project(star.ra, star.dec);
    const c = toCanvas(p.x, p.y, view);
    if (c.x < -20 || c.x > view.width + 20 || c.y < -20 || c.y > view.height + 20) {
      return false;
    }

    return true;
  }

  /**
   * Check if a DSO would actually be rendered given current viewport and limits.
   * Replicates the filtering logic from renderDSOs().
   */
  private isDSORendered(dso: DSO): boolean {
    // Consult the same per-frame selection the renderer uses, so hover/click
    // gating exactly matches what is drawn (including the container-size gate).
    this.selectRenderedDSOs();
    return this.cachedSelectedDSOIds!.has(dso.id);
  }

  /**
   * Schedule a hover hit-test for the next frame, coalescing bursts of mousemove
   * events into one test. Skipped entirely while actively panning/zooming: the
   * object under the cursor changes every frame and no tooltip is being read, so the
   * work is wasted until motion settles.
   */
  private requestHover(mx: number, my: number, clientX: number, clientY: number) {
    this.pendingHover = { mx, my, clientX, clientY };
    if (this.interacting || this.hoverRaf !== null) return;
    this.hoverRaf = requestAnimationFrame(() => {
      this.hoverRaf = null;
      const h = this.pendingHover;
      this.pendingHover = null;
      if (h) this.handleHover(h.mx, h.my, h.clientX, h.clientY);
    });
  }

  private handleHover(mx: number, my: number, clientX: number, clientY: number) {
    const closestStar = this.findClosestStar(mx, my);
    const closestDSO = this.findClosestDSO(mx, my);

    // Verify that found objects would actually be rendered (not hidden by count limits)
    const starRendered = closestStar ? this.isStarRendered(closestStar) : false;
    const dsoRendered = closestDSO ? this.isDSORendered(closestDSO) : false;

    this.hoveredDSO = (closestDSO && dsoRendered) ? closestDSO : null;

    // Find which rendered object is actually closest to the mouse cursor
    const projPt = fromCanvas(mx, my, this.view);
    
    let starDist = Infinity;
    if (closestStar && starRendered) {
      const starProj = project(closestStar.ra, closestStar.dec);
      const dx = starProj.x - projPt.x;
      const dy = starProj.y - projPt.y;
      starDist = Math.sqrt(dx * dx + dy * dy);
    }
    
    let dsoDist = Infinity;
    if (closestDSO && dsoRendered) {
      const dsoProj = project(closestDSO.ra, closestDSO.dec);
      const dx = dsoProj.x - projPt.x;
      const dy = dsoProj.y - projPt.y;
      dsoDist = Math.sqrt(dx * dx + dy * dy);
    }
    
    // Show tooltip for the closest rendered object
    if (starRendered && dsoRendered) {
      // Both found and rendered - show the closest one
      if (starDist < dsoDist) {
        if (this.onStarHover) {
          this.onStarHover(closestStar, clientX, clientY);
        }
      } else {
        if (this.onDSOHover) {
          this.onDSOHover(closestDSO, clientX, clientY);
        }
      }
    } else if (dsoRendered) {
      if (this.onDSOHover) {
        this.onDSOHover(closestDSO, clientX, clientY);
      }
    } else if (starRendered) {
      if (this.onStarHover) {
        this.onStarHover(closestStar, clientX, clientY);
      }
    } else {
      // No rendered object found, hide tooltip
      if (this.onStarHover) {
        this.onStarHover(null, clientX, clientY);
      }
    }
  }

  /**
   * Coalesce bursts of render requests into one redraw per animation frame.
   * High-frequency UI events (pan, wheel, frame drag, resize) and property
   * setters call this instead of render() directly, so the main thread is freed
   * between frames and we never redraw more often than the display refreshes.
   * The export/offscreen path and in-flight animation steps call render() directly.
   */
  requestRender() {
    if (this._renderRaf !== null) return;
    this._renderRaf = requestAnimationFrame(() => {
      this._renderRaf = null;
      this.render();
    });
  }

  /**
   * Mark the map as actively interacting (pan/zoom/drag) and (re)arm the settle
   * timer. While interacting, renderStars/renderDSOs use a reduced density budget
   * (see effectiveStarBudget). When motion stops for SETTLE_MS, the flag clears and
   * a full-budget redraw runs so the less-important objects fill back in. The timer
   * always fires, so the flag can never get stuck on (e.g. an interrupted animation).
   */
  private markInteracting() {
    this.interacting = true;
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      this.interacting = false;
      this.requestRender();
    }, SkyMap.SETTLE_MS);
  }

  /** Coalesced render for motion: throttles the density budget for a smooth frame. */
  requestRenderInteractive() {
    this.markInteracting();
    this.requestRender();
  }

  /**
   * Effective star density budget. In auto mode it is the fixed pinned budget, rendered
   * the same whether moving or not (no pop). In manual mode the motion LOD applies — but
   * only when the DSO lever is NOT auto (when it is, the lever keeps frames smooth, so
   * stars need no throttling either).
   */
  private effectiveStarBudget(): number {
    if (this.autoStarDensity) return this.maxStarCount;
    if (this.motionLOD && this.interacting && !this.autoDSODensity) {
      const floor = Math.min(SkyMap.INTERACTION_STAR_FLOOR, this.maxStarCount);
      return Math.round(floor + (this.maxStarCount - floor) * this.interactionQuality);
    }
    return this.maxStarCount;
  }

  /**
   * Effective DSO density budget. When DSO-auto is on, maxDSOCount is the live performance
   * lever and is used as-is (no motion throttling → no pop). When manual, the motion LOD
   * interpolates floor→full during active interaction.
   */
  private effectiveDSOBudget(): number {
    if (this.motionLOD && !this.autoDSODensity && this.interacting) {
      const floor = Math.min(SkyMap.INTERACTION_DSO_FLOOR, this.maxDSOCount);
      return Math.round(floor + (this.maxDSOCount - floor) * this.interactionQuality);
    }
    return this.maxDSOCount;
  }

  /**
   * Steer interactionQuality from a measured interactive frame draw time. Asymmetric with
   * a hysteresis band for stability: drop fast when over budget (keep motion smooth), creep
   * up slowly when there is clear headroom, and hold steady in between so it doesn't oscillate.
   */
  private adaptInteractionQuality(frameMs: number) {
    const target = SkyMap.INTERACTION_TARGET_MS;
    if (frameMs > target * 1.25) {
      this.interactionQuality = Math.max(0, this.interactionQuality - 0.15);
    } else if (frameMs < target * 0.7) {
      this.interactionQuality = Math.min(1, this.interactionQuality + 0.05);
    }
  }

  /**
   * DSO performance lever: from a measured interactive frame time, nudge the DSO budget
   * multiplicatively toward AUTO_TARGET_MS. Runs only while interacting (motion is the
   * demanding case), and the same budget is then used at rest — so it never creeps up when
   * idle and nothing pops when a gesture starts. A hysteresis band keeps a converged budget
   * stable (factor 1 → no change → no extra render); it also stops at the clamp bounds.
   * Because render cost is pan-invariant, a steady pan triggers no change; only real
   * performance shifts (e.g. zoom) re-tune it.
   */
  private adaptAutoDensity(frameMs: number) {
    if (!this.autoDSODensity) { this.dsoCalibrating = false; return; }
    const target = SkyMap.AUTO_TARGET_MS;
    const factor = frameMs > target * 1.3 ? 0.85 : frameMs < target * 0.6 ? 1.12 : 1;
    if (factor === 1) { this.dsoCalibrating = false; return; } // converged → end any burst
    const next = Math.max(SkyMap.AUTO_DSO_MIN, Math.min(DSO_DENSITY_MAX, Math.round(this.maxDSOCount * factor)));
    if (next === this.maxDSOCount) { this.dsoCalibrating = false; return; } // at a bound → end burst
    this.maxDSOCount = next;
    this.onAutoDensityChange?.(next);
    this.requestRender();
  }

  render() {
    const { ctx, view } = this;
    const { width, height } = view;

    // Time interactive frames to drive the adaptive budgets — plus a one-shot at-rest burst
    // right after DSO-auto is switched on (dsoCalibrating) so the slider re-tunes immediately.
    // Outside those, no measurement: the budget never creeps up at rest, so nothing pops when
    // a gesture starts.
    const measure = !this._renderingOffscreen && (this.interacting || this.dsoCalibrating);
    const t0 = measure ? performance.now() : 0;

    // Invalidate the per-frame DSO selection cache; rebuilt lazily by the first consumer.
    this.cachedSelectedDSOs = null;
    this.cachedSelectedDSOIds = null;

    ctx.save();
    ctx.clearRect(0, 0, width, height);

    this.renderBackground();

    // ── Hemisphere clip circle ──────────────────────────────────────────────
    // In stereo mode: borderLatDeg determines how far into the opposite hemisphere we show.
    // In fisheye mode: borderRadiusPU() returns 1.0 (the horizon circle).
    const poleOrigin = toCanvas(0, 0, view);
    const borderR = borderRadiusPU(this.borderLatDeg) * view.scale;

    ctx.save();
    ctx.beginPath();
    ctx.arc(poleOrigin.x, poleOrigin.y, borderR, 0, Math.PI * 2);
    ctx.clip();

    ctx.globalAlpha = this.skyOpacity;
    if (this.showConstellationLines) {
      this.renderConstellationLines();
    }
    if (this.showDSOs) {
      this.renderDSOs();
    }
    if (this.showStars) {
      this.renderStars();
      if (this.showStarLabels) {
        this.renderStarLabels();
      }
    }
    if (this.showDSOs && this.showDSOLabels) {
      this.renderDSOLabels();
    }
    if (this.showConstellationNames) {
      this.renderConstellationNames();
    }

    ctx.globalAlpha = 1;
    if (this.showGrid) {
      if (this.fisheyeMode) {
        this.renderFisheyeGrid();
      } else {
        this.renderGrid();
      }
    }
    if (this.showPhotoOutlines && this.photoOutlines.length > 0) {
      this.renderPhotoOutlines();
    }
    // Frames are drawn on the overlay canvas (above photos) for live renders,
    // but inline here for offscreen/export renders (see renderOverlay / _renderingOffscreen).
    if (this._renderingOffscreen) {
      if (this.fovFrameSpecs.length > 0) {
        this.renderFovFrames();
      }
      if (this.fovInstances.length > 0) {
        this.renderFovInstances();
      }
    }

    ctx.restore(); // removes clip

    // ── Border ring (drawn after clip restore so it sits on top) ────────────
    ctx.save();
    ctx.beginPath();
    ctx.arc(poleOrigin.x, poleOrigin.y, borderR, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(200, 185, 168, 0.3)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    ctx.restore(); // outer save

    if (!this._renderingOffscreen) {
      this.renderOverlay();
    }

    if (t0) {
      const ms = performance.now() - t0;
      // DSO lever owns smoothness when auto (during motion or a calibration burst); otherwise
      // the manual motion LOD calibrates from interactive frames.
      if (this.autoDSODensity) this.adaptAutoDensity(ms);
      else if (this.interacting) this.adaptInteractionQuality(ms);
    }
  }

  private renderOverlay(): void {
    const oc = this.overlayCtx;
    if (!oc) return;
    const { view } = this;
    const { width, height } = view;

    oc.clearRect(0, 0, width, height);

    if (this.fovFrameSpecs.length === 0 && this.fovInstances.length === 0) return;

    const poleOrigin = toCanvas(0, 0, view);
    const borderR = borderRadiusPU(this.borderLatDeg) * view.scale;

    oc.save();
    oc.beginPath();
    oc.arc(poleOrigin.x, poleOrigin.y, borderR, 0, Math.PI * 2);
    oc.clip();

    // Temporarily route ctx to the overlay canvas so renderFovFrames / renderFovInstances
    // draw there without any other changes to those methods.
    const mainCtx = this.ctx;
    this.ctx = oc;
    if (this.fovFrameSpecs.length > 0) this.renderFovFrames();
    if (this.fovInstances.length > 0) this.renderFovInstances();
    this.ctx = mainCtx;

    oc.restore();
  }

  private renderPhotoOutlines() {
    const { ctx } = this;

    for (const outline of this.photoOutlines) {
      const { corners, name } = outline;
      if (corners.length < 4) continue;

      ctx.save();
      ctx.strokeStyle = 'rgba(192, 120, 48, 0.55)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);

      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < corners.length; i++) {
        ctx.lineTo(corners[i].x, corners[i].y);
      }
      ctx.closePath();
      ctx.stroke();

      // Label along the longest edge, always readable (not upside-down)
      ctx.setLineDash([]);
      ctx.font = '11px sans-serif';
      ctx.fillStyle = 'rgba(192, 120, 48, 0.85)';

      const edgeIdx = photoLabelEdgeIndex(corners);
      const label = photoLabelTransform(corners, edgeIdx);

      ctx.save();
      ctx.translate(label.x, label.y);
      ctx.rotate(label.angle);
      ctx.fillText(name, 4, -5);
      ctx.restore();

      ctx.restore();
    }
  }

  private renderFovFrames() {
    const { ctx, view } = this;
    const cx = view.width / 2;
    const cy = view.height / 2;
    const { dec } = unproject(view.centerX, view.centerY);

    // Resolve CSS token values from computed style (canvas does not support CSS vars directly)
    const cs = getComputedStyle(this.canvas);
    const strokeColor = cs.getPropertyValue('--fov-frame-stroke').trim() || 'rgba(220,60,60,0.85)';
    const labelColor  = cs.getPropertyValue('--fov-frame-label').trim()  || 'rgba(220,90,90,0.9)';

    for (const spec of this.fovFrameSpecs) {
      const halfWPx = angularSizeToCanvasPx(spec.wDeg * 30, dec, view.scale);
      const halfHPx = angularSizeToCanvasPx(spec.hDeg * 30, dec, view.scale);
      const corners = computeFovFrameCorners(halfWPx, halfHPx, cx, cy, this.fovRotationDeg);

      ctx.save();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([8, 4]);

      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < corners.length; i++) {
        ctx.lineTo(corners[i].x, corners[i].y);
      }
      ctx.closePath();
      ctx.stroke();

      ctx.setLineDash([]);
      ctx.font = '11px sans-serif';
      ctx.fillStyle = labelColor;

      const edgeIdx = photoLabelEdgeIndex(corners);
      const lbl = photoLabelTransform(corners, edgeIdx);

      ctx.save();
      ctx.translate(lbl.x, lbl.y);
      ctx.rotate(lbl.angle);
      ctx.fillText(spec.label, 4, -5);
      ctx.restore();

      ctx.restore();
    }
  }

  // ── Interactive frame instances ────────────────────────────────────────────

  /** Canvas centre for a frame instance (resolved from its anchor + live view). */
  private frameAnchorCanvas(f: RenderableFrame): { cx: number; cy: number } {
    if (f.anchorKind === 'sky') {
      const p = project(f.ra ?? 0, f.dec ?? 0);
      const c = toCanvas(p.x, p.y, this.view);
      return { cx: c.x, cy: c.y };
    }
    return { cx: (f.nx ?? 0.5) * this.view.width, cy: (f.ny ?? 0.5) * this.view.height };
  }

  /**
   * Canvas rotation (deg) of a pinned frame for a given position angle. The
   * frame's *up* (top edge) must point to celestial north at PA 0°, so we add
   * 90° to `dsoCanvasAngle` — which orients a DSO's *major axis* (local +x).
   */
  private paToCanvasRotDeg(paDeg: number, raDeg: number): number {
    return paToCanvasRotationDeg(paDeg, raDeg, this.view.rotationDeg);
  }

  /** Inverse of {@link paToCanvasRotDeg}: recover PA (°E of N) from a canvas rotation. */
  private canvasRotDegToPa(rotDeg: number, raDeg: number): number {
    return canvasRotationToPaDeg(rotDeg, raDeg, this.view.rotationDeg);
  }

  /** Canvas rotation (deg) for a frame instance. */
  private frameCanvasRotationDeg(f: RenderableFrame): number {
    if (f.anchorKind === 'sky') {
      return this.paToCanvasRotDeg(f.paDeg ?? 0, f.ra ?? 0);
    }
    return f.screenRotationDeg ?? 0;
  }

  private frameGeometry(f: RenderableFrame): { corners: Point[]; cx: number; cy: number; rotDeg: number; halfW: number; halfH: number } {
    // A mosaic outline hugs its tiles exactly via tangent-plane (gnomonic)
    // geometry. The same geometry is used whether it's pinned or floating (centre
    // and PA are derived from the anchor either way), so the pin/float toggle is
    // continuous — no jump — and shares the standard frame code.
    if (f.isMosaicOutline) {
      const g = this.mosaicOutlineGeometry(f);
      if (g) return g;
    }
    const { cx, cy } = this.frameAnchorCanvas(f);
    const decForSize = f.anchorKind === 'sky' ? (f.dec ?? 0) : unproject(this.view.centerX, this.view.centerY).dec;
    const halfW = angularSizeToCanvasPx(f.wDeg * 30, decForSize, this.view.scale);
    const halfH = angularSizeToCanvasPx(f.hDeg * 30, decForSize, this.view.scale);
    const rotDeg = this.frameCanvasRotationDeg(f);
    const corners = computeFovFrameCorners(halfW, halfH, cx, cy, rotDeg);
    return { corners, cx, cy, rotDeg, halfW, halfH };
  }

  /**
   * Sky centre + position angle of a mosaic outline. Pinned: the stored centre
   * and PA. Floating: the sky point under its screen anchor and the PA that
   * reproduces its screen rotation there — so the gnomonic geometry is continuous
   * as the pin toggles between sky and screen.
   */
  private mosaicCenterPa(f: RenderableFrame): { center: { ra: number; dec: number }; paDeg: number } | null {
    if (f.anchorKind === 'sky') {
      if (f.ra == null || f.dec == null) return null;
      return { center: { ra: f.ra, dec: f.dec }, paDeg: f.paDeg ?? 0 };
    }
    const { cx, cy } = this.frameAnchorCanvas(f);
    const proj = fromCanvas(cx, cy, this.view);
    const center = unproject(proj.x, proj.y);
    return { center, paDeg: this.canvasRotDegToPa(f.screenRotationDeg ?? 0, center.ra) };
  }

  /**
   * Handle geometry of a mosaic outline: its four region corners (the exact
   * tangent-plane corners that {@link mosaicOutlinePath} draws to, so handles sit
   * on the outline), plus centre, rotation and local half-extents.
   */
  private mosaicOutlineGeometry(f: RenderableFrame): { corners: Point[]; cx: number; cy: number; rotDeg: number; halfW: number; halfH: number } | null {
    const cp = this.mosaicCenterPa(f);
    if (!cp) return null;
    const halfW = f.wDeg / 2, halfH = f.hDeg / 2;
    const corner = (gx: number, gy: number): Point => {
      const s = framePointToSky(cp.center, cp.paDeg, gx, gy);
      const p = project(s.ra, s.dec);
      return toCanvas(p.x, p.y, this.view);
    };
    // gy+ is "up" (frame north), which is computeFovFrameCorners' −y, so these map
    // to its clockwise-from-top-left corner order.
    const corners = [corner(-halfW, halfH), corner(halfW, halfH), corner(halfW, -halfH), corner(-halfW, -halfH)];
    const cx = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4;
    const cy = (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4;
    const rotDeg = this.frameCanvasRotationDeg(f);
    const a = rotDeg * DEG2RAD, cos = Math.cos(a), sin = Math.sin(a);
    let minL = Infinity, maxL = -Infinity, minM = Infinity, maxM = -Infinity;
    for (const p of corners) {
      const l = p.x * cos + p.y * sin, m = -p.x * sin + p.y * cos;
      minL = Math.min(minL, l); maxL = Math.max(maxL, l);
      minM = Math.min(minM, m); maxM = Math.max(maxM, m);
    }
    return { corners, cx, cy, rotDeg, halfW: (maxL - minL) / 2, halfH: (maxM - minM) / 2 };
  }

  /**
   * Outline polyline of a mosaic: the boundary of its tangent-plane region,
   * sampled and projected so it follows the exact same geometry as the tiles
   * (they share the placement math). Curves with the projection just like the
   * grid does — unlike a straight corner-to-corner rectangle.
   */
  private mosaicOutlinePath(f: RenderableFrame): Point[] | null {
    const cp = this.mosaicCenterPa(f);
    if (!cp) return null;
    const { center, paDeg } = cp;
    const halfW = f.wDeg / 2, halfH = f.hDeg / 2;
    const N = 16; // samples per edge — enough to render the curvature smoothly
    const pts: Point[] = [];
    const add = (gx: number, gy: number) => {
      const s = framePointToSky(center, paDeg, gx, gy);
      const p = project(s.ra, s.dec);
      pts.push(toCanvas(p.x, p.y, this.view));
    };
    for (let i = 0; i <= N; i++) add(-halfW + (2 * halfW * i) / N, halfH);   // top
    for (let i = 1; i <= N; i++) add(halfW, halfH - (2 * halfH * i) / N);    // right
    for (let i = 1; i <= N; i++) add(halfW - (2 * halfW * i) / N, -halfH);   // bottom
    for (let i = 1; i < N; i++) add(-halfW, -halfH + (2 * halfH * i) / N);   // left
    return pts;
  }

  /** Handles (rotation needle, pin, centre dot) are shown only while the frame
   * is large enough that its centre dot isn't crowding the edges. */
  private frameHandlesVisible(halfW: number, halfH: number): boolean {
    return Math.min(halfW, halfH) >= 12;
  }

  private renderFovInstances() {
    const { ctx } = this;
    const cs = getComputedStyle(this.canvas);
    const strokeColor = cs.getPropertyValue('--fov-frame-stroke').trim() || 'rgba(220,60,60,0.85)';
    const labelColor  = cs.getPropertyValue('--fov-frame-label').trim()  || 'rgba(220,90,90,0.9)';
    const activeColor = cs.getPropertyValue('--accent-color').trim() || labelColor;
    const dangerColor = cs.getPropertyValue('--color-danger').trim() || '#cc7777';
    // The selected mosaic's tiles each get a delete button (per-tile editing).
    const activeMosaicId = this.fovInstances.find(f => f.active && f.isMosaicOutline)?.id.split(':')[2];

    for (const f of this.fovInstances) {
      if (f.visible === false) continue; // hidden via the manager checkbox
      const { corners, cx, cy, rotDeg, halfW, halfH } = this.frameGeometry(f);
      const isActive = f.active;
      const isTile = !!f.mosaicId; // a faint mosaic panel (the outline frame draws the rest)

      ctx.save();
      ctx.globalAlpha = isTile ? 0.4 : isActive ? 1 : 0.5;
      ctx.strokeStyle = isActive && !isTile ? activeColor : strokeColor;
      ctx.lineWidth = isActive && !isTile ? 2 : 1.5;
      ctx.setLineDash([8, 4]);
      // A mosaic outline traces its tile perimeter (follows projection curvature);
      // every other frame is its 4-corner rectangle.
      const outline = f.isMosaicOutline ? (this.mosaicOutlinePath(f) ?? corners) : corners;
      ctx.beginPath();
      ctx.moveTo(outline[0].x, outline[0].y);
      for (let i = 1; i < outline.length; i++) ctx.lineTo(outline[i].x, outline[i].y);
      ctx.closePath();
      ctx.stroke();

      if (isTile) {
        // Border tiles of the selected mosaic carry a delete button (large tiles only).
        if (f.mosaicId === activeMosaicId && f.mosaicIsBorderTile && this.tileTrashVisible(halfW, halfH)) {
          ctx.globalAlpha = 1;
          this.drawTileTrash({ x: cx, y: cy }, dangerColor);
        }
        ctx.restore();
        continue; // tiles: outline only, no label/handles
      }

      // Label (setup name only) along the longest edge — hidden when the frame
      // is too small to read it.
      const edgeIdx = photoLabelEdgeIndex(corners);
      const a = corners[edgeIdx];
      const b = corners[(edgeIdx + 1) % corners.length];
      const longEdgePx = Math.hypot(b.x - a.x, b.y - a.y);
      if (longEdgePx >= 48) {
        ctx.setLineDash([]);
        ctx.font = '11px sans-serif';
        ctx.fillStyle = isActive ? activeColor : labelColor;
        const lbl = photoLabelTransform(corners, edgeIdx);
        ctx.save();
        ctx.translate(lbl.x, lbl.y);
        ctx.rotate(lbl.angle);
        ctx.fillText(f.name, 4, -5);
        ctx.restore();
      }

      // Handles on the active frame only (so other frames stay locked), and only
      // while the frame is large enough that the centre dot isn't near the edges.
      if (isActive && this.frameHandlesVisible(halfW, halfH)) {
        const ang = rotDeg * DEG2RAD;
        const topMidX = cx + halfH * Math.sin(ang);
        const topMidY = cy - halfH * Math.cos(ang);
        const h = rotateHandlePos(cx, cy, halfH, rotDeg, 24);
        ctx.strokeStyle = activeColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(topMidX, topMidY);
        ctx.lineTo(h.x, h.y);
        ctx.stroke();
        ctx.fillStyle = activeColor;
        ctx.beginPath();
        ctx.arc(h.x, h.y, 5, 0, Math.PI * 2);
        ctx.fill();
        if (f.movable) {
          // Move handle (centre dot).
          ctx.beginPath();
          ctx.arc(cx, cy, 4, 0, Math.PI * 2);
          ctx.fill();
        }
        if (f.pinnable) {
          // Pin toggle glyph: pushpin lifted just above the top-right corner.
          this.drawPinGlyph(this.framePinGlyphPos(corners[1], rotDeg), f.anchorKind === 'sky', activeColor);
        }
        if (f.resizable) {
          // Corner resize handles (small squares) — drag to extend into a mosaic.
          ctx.fillStyle = activeColor;
          for (const c of corners) ctx.fillRect(c.x - 3, c.y - 3, 6, 6);
        }
      }
      ctx.restore();
    }

    // Rubber-band preview of a drag-to-extend in progress.
    if (this.resizeDraft) {
      const d = this.resizeDraft;
      const pv = computeFovFrameCorners(d.halfW, d.halfH, d.cx, d.cy, d.rotDeg);
      ctx.save();
      ctx.strokeStyle = activeColor;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(pv[0].x, pv[0].y);
      for (let i = 1; i < pv.length; i++) ctx.lineTo(pv[i].x, pv[i].y);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }

    // Elastic line: while moving a frame whose anchor will snap, a taut line runs
    // from the frame centre (cursor) to the pending DSO's centre. It tightens
    // (brighter + thicker) as the frame nears the break threshold, signalling the
    // snap-back that fires on release; it vanishes when the elastic "breaks".
    if (this.snapCandidate && this.frameDrag?.mode === 'move') {
      const f = this.fovInstances.find(x => x.id === this.frameDrag!.id);
      if (f) {
        const snap = this.snapCandidate;
        const { cx, cy } = this.frameAnchorCanvas(f);
        const dp = project(snap.ra, snap.dec);
        const dc = toCanvas(dp.x, dp.y, this.view);
        // Break radius mirrors findClosestDSO: the rendered ellipse, floored at 20px.
        const rx = Math.max(2, angularSizeToCanvasPx(snap.majAxis / 2, snap.dec, this.view.scale));
        const breakPx = Math.max(rx, 20);
        const tension = Math.min(1, Math.hypot(cx - dc.x, cy - dc.y) / breakPx);
        ctx.save();
        ctx.strokeStyle = activeColor;
        ctx.fillStyle = activeColor;
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.5 + 0.5 * tension;
        ctx.lineWidth = 1.5 + 1.5 * tension;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(dc.x, dc.y);
        ctx.stroke();
        // Ring marking the snap target at the DSO centre.
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(dc.x, dc.y, 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Add ("+") buttons at the empty neighbour cells of the selected mosaic.
    if (activeMosaicId && this.mosaicAddCandidates.length && this.mosaicEditButtonsVisible(activeMosaicId)) {
      const avoid = this.activeOutlineRotateAvoid();
      for (const c of this.mosaicAddCandidates) this.drawTileAdd(this.candidateCanvasPoint(c, avoid), activeColor);
    }
  }

  /** Pin glyph position: the top-right corner lifted outward (local "up") so the
   * icon sits just above the frame with a small margin. */
  private framePinGlyphPos(corner: Point, rotDeg: number): Point {
    const ang = rotDeg * DEG2RAD;
    const margin = 14; // half icon (8) + a few px gap
    return { x: corner.x + Math.sin(ang) * margin, y: corner.y - Math.cos(ang) * margin };
  }

  /** Draw the pushpin glyph centred at `at`, filled when pinned. Source path is a 24×24 box. */
  private drawPinGlyph(at: Point, filled: boolean, color: string): void {
    const { ctx } = this;
    const size = 16;
    ctx.save();
    ctx.translate(at.x - size / 2, at.y - size / 2);
    ctx.scale(size / 24, size / 24);
    const path = getPinPath();
    if (filled) {
      ctx.fillStyle = color;
      ctx.fill(path);
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8 * (24 / size);
      ctx.stroke(path);
    }
    ctx.restore();
  }

  /** Radius of a tile's delete button, and whether the tile is large enough to host one. */
  private static readonly TILE_TRASH_R = 11;
  private tileTrashVisible(halfW: number, halfH: number): boolean {
    return Math.min(halfW, halfH) >= 16; // only on tiles big enough that the icon fits
  }

  /** Draw a delete (trash) button centred at `at`, used per-tile on the selected mosaic. */
  private drawTileTrash(at: Point, color: string): void {
    const { ctx } = this;
    const size = 16;
    ctx.save();
    ctx.beginPath();
    ctx.arc(at.x, at.y, SkyMap.TILE_TRASH_R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(15,15,18,0.78)';
    ctx.fill();
    ctx.translate(at.x - size / 2, at.y - size / 2);
    ctx.scale(size / 24, size / 24);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 * (24 / size);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(getTrashPath());
    ctx.restore();
  }

  /** Draw an add (plus) button centred at `at`, used at the "+" spots around a mosaic. */
  private drawTileAdd(at: Point, color: string): void {
    const { ctx } = this;
    ctx.save();
    ctx.beginPath();
    ctx.arc(at.x, at.y, SkyMap.TILE_TRASH_R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(15,15,18,0.78)';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(at.x - 5, at.y); ctx.lineTo(at.x + 5, at.y);
    ctx.moveTo(at.x, at.y - 5); ctx.lineTo(at.x, at.y + 5);
    ctx.stroke();
    ctx.restore();
  }

  /** Whether the selected mosaic's tiles are large enough to host their edit
   * buttons (delete / add), and the canvas point of an add candidate. */
  private mosaicEditButtonsVisible(mosaicId: string): boolean {
    const t = this.fovInstances.find(f => f.mosaicId === mosaicId);
    if (!t) return false;
    const g = this.frameGeometry(t);
    return this.tileTrashVisible(g.halfW, g.halfH);
  }

  /** The selected mosaic outline's rotate-handle position + centre, so add ("+")
   * buttons can be nudged clear of the rotation needle. Null when not applicable. */
  private activeOutlineRotateAvoid(): { handle: Point; center: Point } | null {
    const outline = this.fovInstances.find(f => f.active && f.isMosaicOutline);
    if (!outline) return null;
    const geo = this.frameGeometry(outline);
    if (!this.frameHandlesVisible(geo.halfW, geo.halfH)) return null;
    return { handle: rotateHandlePos(geo.cx, geo.cy, geo.halfH, geo.rotDeg, 24), center: { x: geo.cx, y: geo.cy } };
  }

  /** Canvas point of an add candidate. If it would sit on the rotate needle, push
   * it outward (away from the mosaic centre) past the handle so it stays clickable. */
  private candidateCanvasPoint(c: { ra: number; dec: number }, avoid?: { handle: Point; center: Point } | null): Point {
    const p = project(c.ra, c.dec);
    let pt = toCanvas(p.x, p.y, this.view);
    if (avoid && Math.hypot(pt.x - avoid.handle.x, pt.y - avoid.handle.y) < SkyMap.TILE_TRASH_R * 2 + 4) {
      const dx = pt.x - avoid.center.x, dy = pt.y - avoid.center.y;
      const len = Math.hypot(dx, dy) || 1;
      const newDist = Math.hypot(avoid.handle.x - avoid.center.x, avoid.handle.y - avoid.center.y) + SkyMap.TILE_TRASH_R + 14;
      pt = { x: avoid.center.x + (dx / len) * newDist, y: avoid.center.y + (dy / len) * newDist };
    }
    return pt;
  }

  /** Hit-test the active/instance frames on mousedown. Returns true if the event was consumed (no pan). */
  private handleFrameMouseDown(mx: number, my: number): boolean {
    if (!this.interactionEnabled || this.pickingMode || this.fovInstances.length === 0) return false;

    const active = this.fovInstances.find(f => f.active);
    if (active && active.visible !== false) {
      const geo = this.frameGeometry(active);
      const handlesVisible = this.frameHandlesVisible(geo.halfW, geo.halfH);
      if (handlesVisible) {
        const rh = rotateHandlePos(geo.cx, geo.cy, geo.halfH, geo.rotDeg, 24);
        if (isNearHandle(mx, my, rh, 9)) {
          this.frameDrag = { id: active.id, mode: 'rotate' };
          return true;
        }
        if (active.pinnable) {
          const pinPos = this.framePinGlyphPos(geo.corners[1], geo.rotDeg);
          if (isNearHandle(mx, my, pinPos, 10)) { this.toggleFramePin(active); return true; }
        }
        // Corner resize handles (drag-to-extend into a mosaic) take priority over
        // the centre move dot and border move.
        if (active.resizable) {
          for (let i = 0; i < geo.corners.length; i++) {
            if (isNearHandle(mx, my, geo.corners[i], 9)) {
              this.frameDrag = { id: active.id, mode: 'resize', corner: i };
              return true;
            }
          }
        }
        if (active.movable && isNearHandle(mx, my, { x: geo.cx, y: geo.cy }, 9)) {
          this.frameDrag = { id: active.id, mode: 'move' };
          return true;
        }
      }
      // Dragging the border moves the active frame at any size.
      if (active.movable && isNearPolygonBorder(mx, my, geo.corners, 6)) {
        this.frameDrag = { id: active.id, mode: 'move' };
        return true;
      }
      // Per-tile editing: the selected mosaic shows a delete button on each tile
      // and an add ("+") button at each empty neighbour cell.
      if (active.isMosaicOutline) {
        const mosaicId = active.id.split(':')[2];
        if (this.mosaicEditButtonsVisible(mosaicId)) {
          const avoid = this.activeOutlineRotateAvoid();
          for (const c of this.mosaicAddCandidates) {
            if (isNearHandle(mx, my, this.candidateCanvasPoint(c, avoid), SkyMap.TILE_TRASH_R)) {
              this.onMosaicTileAdd?.(c.ra, c.dec);
              return true;
            }
          }
          for (const t of this.fovInstances) {
            if (t.mosaicId !== mosaicId || !t.mosaicIsBorderTile) continue;
            const tg = this.frameGeometry(t);
            if (isNearHandle(mx, my, { x: tg.cx, y: tg.cy }, SkyMap.TILE_TRASH_R)) {
              this.onMosaicTileRemove?.(t.id);
              return true;
            }
          }
        }
      }
    }

    // Select a frame by clicking anywhere inside it (topmost first). Mosaic tiles
    // (mosaicId set) aren't selectable — the mosaic's outline frame is.
    for (let i = this.fovInstances.length - 1; i >= 0; i--) {
      const f = this.fovInstances[i];
      if (f.active || f.visible === false || f.mosaicId) continue;
      const geo = this.frameGeometry(f);
      if (pointInConvexPolygon(mx, my, geo.corners)) {
        this.selectFrame(f.id);
        return true;
      }
    }

    // Clicked the interior / empty space: let the map pan. The active frame
    // stays selected (deselect explicitly via the popup or the Escape key) so
    // panning the sky under a floating frame never loses the selection.
    return false;
  }

  /** Toggle the pin state of a frame by id (used by the frame-manager popup). */
  toggleFramePinById(id: string): void {
    const f = this.fovInstances.find(x => x.id === id);
    if (f && f.pinnable) this.toggleFramePin(f);
  }

  /** Sky coordinates (degrees) at the centre of the current viewport — used to
   * spawn a new frame on the visible sky. */
  viewCenterSky(): { ra: number; dec: number } {
    const proj = fromCanvas(this.view.width / 2, this.view.height / 2, this.view);
    return unproject(proj.x, proj.y);
  }

  /** Pin the currently-active frame if it is still floating (used when the
   * selection changes — only the selected frame stays free to move). */
  pinActiveIfFloating(): void {
    const active = this.fovInstances.find(f => f.active);
    if (active && active.pinnable && active.anchorKind === 'screen') this.toggleFramePin(active);
  }

  /** Change the active frame, auto-pinning the previously-active floating one. */
  selectFrame(id: string | null): void {
    this.pinActiveIfFloating();
    this.onFovInstanceSelect?.(id);
  }

  /**
   * Toggle a movable frame between floating (screen) and pinned (sky) at its
   * current centre. The on-screen orientation is preserved across the switch by
   * converting the rotation value (screen rotation ↔ position angle), so pinning
   * never appears to rotate the frame — it only changes the anchor.
   */
  private toggleFramePin(f: RenderableFrame): void {
    if (!f.pinnable) return;
    if (f.anchorKind === 'sky') {
      const { cx, cy } = this.frameAnchorCanvas(f);
      const canvasRotDeg = this.frameCanvasRotationDeg(f);
      // Pinned → floating: the canvas rotation becomes the screen rotation as-is.
      this.onFovInstanceChange?.(f.id, {
        anchor: { kind: 'screen', nx: cx / this.view.width, ny: cy / this.view.height },
        screenRotationDeg: normalizeRotationDeg(canvasRotDeg),
      });
    } else {
      // Floating → pinned: snap to the nearest DSO when the anchor is on.
      this.pinFloatingFrame(f, f.anchorSnap !== false);
    }
  }

  /**
   * Pin a floating frame to the sky at its current centre, converting its canvas
   * rotation to a position angle so it stays visually put. When `snap` is true the
   * centre is anchored to the nearest DSO; when false it is pinned exactly where it
   * sits (used when freezing frames so nothing moves).
   */
  private pinFloatingFrame(f: RenderableFrame, snap: boolean): void {
    if (!f.pinnable || f.anchorKind !== 'screen') return;
    const { cx, cy } = this.frameAnchorCanvas(f);
    const canvasRotDeg = this.frameCanvasRotationDeg(f);
    let ra: number, dec: number, dsoId: string | null;
    const near = snap ? this.findClosestDSO(cx, cy) : null;
    if (near) {
      // Anchored: the snapped object sits at the centre, so it is the target.
      ra = near.ra; dec = near.dec; dsoId = near.id;
    } else {
      const proj = fromCanvas(cx, cy, this.view);
      const u = unproject(proj.x, proj.y);
      ra = u.ra; dec = u.dec; dsoId = null;
      // A plan frame placed freely takes the DSO nearest its centre that falls
      // inside it (custom location if none).
      if (f.derivesTargetFromContent) {
        const moved: RenderableFrame = { ...f, anchorKind: 'sky', ra, dec };
        dsoId = frameTargetDso(this.dsosInFrame(moved).map(d => d.id));
      }
    }
    const paDeg = this.canvasRotDegToPa(canvasRotDeg, ra);
    this.onFovInstanceChange?.(f.id, { anchor: { kind: 'sky', ra, dec, dsoId }, paDeg });
  }

  /**
   * Pin every floating frame to its exact current sky position (no DSO snap),
   * locking them to the sky so a later view change can't drift them. Called when
   * hiding all frames so nothing moves while the overlay is off.
   */
  pinAllFloatingFrames(): void {
    for (const f of this.fovInstances) {
      if (f.pinnable && f.anchorKind === 'screen') this.pinFloatingFrame(f, false);
    }
  }

  /**
   * Re-run anchor detection on a pinned frame at its current centre and snap it
   * onto the nearest DSO when one is close enough — the same snap the pin action
   * applies with the anchor on. Used by the anchor toggle so turning the anchor
   * on re-anchors an already-pinned frame. No-op for floating frames or when no
   * DSO is close enough (the frame keeps its current position and target).
   */
  resnapFrame(id: string): void {
    const f = this.fovInstances.find(x => x.id === id);
    if (!f || !f.pinnable || f.anchorKind !== 'sky') return;
    const { cx, cy } = this.frameAnchorCanvas(f);
    const near = this.findClosestDSO(cx, cy);
    if (!near) return;
    // Keep the frame's on-screen orientation across the re-anchor by recomputing
    // the PA at the snapped object's RA.
    const canvasRotDeg = this.frameCanvasRotationDeg(f);
    const paDeg = this.canvasRotDegToPa(canvasRotDeg, near.ra);
    this.onFovInstanceChange?.(f.id, {
      anchor: { kind: 'sky', ra: near.ra, dec: near.dec, dsoId: near.id },
      paDeg,
    });
  }

  /** Cancel any in-flight frame snap-back animation. */
  private cancelSnapAnim(): void {
    if (this.snapAnim) {
      cancelAnimationFrame(this.snapAnim.raf);
      this.snapAnim = null;
    }
  }

  /**
   * Spring a just-dropped frame from its current (cursor) centre to the snap
   * target's DSO centre over a short ease-out, then commit the anchor with the
   * DSO as its target. The frame's on-screen orientation is held by recomputing
   * the PA at each interpolated RA (as the drag does).
   */
  private animateSnapToDso(id: string, snap: { id: string; ra: number; dec: number }): void {
    this.cancelSnapAnim();
    const f = this.fovInstances.find(x => x.id === id);
    if (!f || f.anchorKind !== 'sky') return;
    const startRa = f.ra ?? snap.ra;
    const startDec = f.dec ?? snap.dec;
    // Shortest-arc RA delta so a wrap across 0/360 doesn't sweep the long way.
    let dRa = snap.ra - startRa;
    if (dRa > 180) dRa -= 360;
    else if (dRa < -180) dRa += 360;
    const dDec = snap.dec - startDec;
    const canvasRotDeg = this.frameCanvasRotationDeg(f);
    const duration = 150;
    const startTime = performance.now();

    const step = (now: number) => {
      let t = (now - startTime) / duration;
      if (t >= 1) t = 1;
      const ease = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const ra = normalizeRA(startRa + dRa * ease);
      const dec = startDec + dDec * ease;
      const paDeg = this.canvasRotDegToPa(canvasRotDeg, ra);
      const done = t >= 1;
      // Keep the DSO target bound for every frame of the spring (it's known the
      // whole time); a null mid-flight would flip a mosaic's name to the gear spec.
      this.onFovInstanceChange?.(id, {
        anchor: { kind: 'sky', ra: done ? snap.ra : ra, dec: done ? snap.dec : dec, dsoId: snap.id },
        paDeg,
      });
      if (done) {
        this.snapAnim = null;
      } else {
        this.snapAnim = { id, raf: requestAnimationFrame(step) };
      }
    };
    this.snapAnim = { id, raf: requestAnimationFrame(step) };
  }

  /**
   * Bring the given frame to the centre of the view (used by the frame manager).
   * Idempotent: a pinned frame pans the view to its sky anchor; a floating frame
   * snaps its own screen anchor back to the viewport centre.
   */
  centerFrameInView(id: string): void {
    const f = this.fovInstances.find(x => x.id === id);
    if (!f) return;
    if (f.anchorKind === 'sky') {
      // Same framing zoom the targets "view on map" button uses.
      const minDim = Math.min(this.view.width, this.view.height);
      const scale = computeFovTargetScale(f.wDeg, f.hDeg, f.dec ?? 0, getHemisphere(), minDim);
      this.navigateTo(f.ra ?? 0, f.dec ?? 0, scale, true);
    } else {
      this.onFovInstanceChange?.(f.id, { anchor: { kind: 'screen', nx: 0.5, ny: 0.5 } });
    }
  }

  /** Apply a frame move/rotate drag for the current cursor position. */
  private handleFrameDragMove(mx: number, my: number): void {
    if (!this.frameDrag) return;
    const f = this.fovInstances.find(x => x.id === this.frameDrag!.id);
    if (!f) { this.frameDrag = null; return; }

    if (this.frameDrag.mode === 'resize') {
      // Recompute the rubber-band rectangle from the (unchanged) frame geometry's
      // fixed corner and the cursor; nothing is committed until mouseup.
      const geo = this.frameGeometry(f);
      const r = resizeFromCorner(geo.corners, this.frameDrag.corner ?? 2, mx, my, geo.rotDeg);
      let { halfW, halfH } = r;
      // Smart-scope frame: clamp the rubber band to the scope's mosaic envelope
      // live (per-axis cap + area cap). resizeFromCorner keeps the centre fixed,
      // so clamping the half-extents alone keeps the preview anchored.
      if (f.smartMosaic) {
        const reqWDeg = f.wDeg * (r.halfW / Math.max(1e-6, geo.halfW));
        const reqHDeg = f.hDeg * (r.halfH / Math.max(1e-6, geo.halfH));
        const c = clampSmartMosaicSize(reqWDeg, reqHDeg, f.smartMosaic.nativeWDeg, f.smartMosaic.nativeHDeg, f.smartMosaic.env);
        halfW = (c.wDeg / Math.max(1e-6, f.wDeg)) * geo.halfW;
        halfH = (c.hDeg / Math.max(1e-6, f.hDeg)) * geo.halfH;
      }
      this.resizeDraft = { cx: r.cx, cy: r.cy, halfW, halfH, rotDeg: geo.rotDeg };
      this.requestRenderInteractive();
      return;
    }

    if (this.frameDrag.mode === 'rotate') {
      const { cx, cy } = this.frameAnchorCanvas(f);
      const rotDeg = canvasRotationDegFromCursor(cx, cy, mx, my);
      if (f.anchorKind === 'sky') {
        const pa = this.canvasRotDegToPa(rotDeg, f.ra ?? 0);
        this.onFovInstanceChange?.(f.id, { paDeg: pa });
      } else {
        this.onFovInstanceChange?.(f.id, { screenRotationDeg: normalizeRotationDeg(rotDeg) });
      }
    } else {
      if (f.anchorKind === 'sky') {
        // Hold the frame's on-screen orientation fixed while moving: a pinned
        // frame's rotation is a position angle relative to celestial north,
        // whose screen direction changes across the projection — so without
        // this the frame would spin to stay north-aligned as it's dragged.
        const canvasRotDeg = this.frameCanvasRotationDeg(f);
        // The centre always follows the cursor exactly — no mid-drag jump. When
        // the anchor is on and a DSO is within snap range we only *record* it as
        // the pending snap target (drawn as the elastic line); the actual snap
        // happens on mouse-up via animateSnapToDso.
        const proj = fromCanvas(mx, my, this.view);
        const u = unproject(proj.x, proj.y);
        const ra = u.ra, dec = u.dec;
        let dsoId: string | null = null;
        const near = f.anchorSnap !== false ? this.findClosestDSO(mx, my) : null;
        // Recompute the PA so the frame keeps the same on-screen angle at the
        // new position.
        const paDeg = this.canvasRotDegToPa(canvasRotDeg, ra);
        if (near) {
          this.snapCandidate = { id: near.id, ra: near.ra, dec: near.dec, majAxis: near.majAxis ?? 1 };
          // Keep the pending target *bound* while the elastic is shown. The centre
          // still follows the cursor (it springs to the DSO only on release), but
          // nulling the target here would, for a mosaic, drop its dsoId — flipping
          // its name to the gear spec and turning anchorSnap off, which then
          // toggles back on next frame and flickers. Binding it keeps identity stable.
          dsoId = near.id;
        } else {
          this.snapCandidate = null;
          // A plan/mosaic frame dragged out of snap range takes the DSO nearest
          // its centre that falls inside it (custom location if none).
          if (f.derivesTargetFromContent) {
            const moved: RenderableFrame = { ...f, ra, dec, paDeg };
            dsoId = frameTargetDso(this.dsosInFrame(moved).map(d => d.id));
          }
        }
        // Emitting the change drives the re-render (via the store watch →
        // setFovInstances), which redraws the elastic from the frame's updated
        // centre. No explicit render() here — a synchronous one would paint the
        // line from the frame's stale (pre-change) position and flicker.
        this.onFovInstanceChange?.(f.id, { anchor: { kind: 'sky', ra, dec, dsoId }, paDeg });
      } else {
        this.onFovInstanceChange?.(f.id, { anchor: { kind: 'screen', nx: mx / this.view.width, ny: my / this.view.height } });
      }
    }
  }

  /** After moving a standalone plan frame, merge it if it now overlaps another
   * frame or a mosaic of the same plan (emits the merge for the store to apply). */
  private checkFrameMerge(movedId: string): void {
    if (!this.onFrameMerge) return;
    const moved = this.fovInstances.find(f => f.id === movedId);
    if (!moved) return;
    const movedPlan = movedId.split(':')[1];
    const movedCorners = this.frameGeometry(moved).corners;
    for (const f of this.fovInstances) {
      if (f.id === movedId || f.mosaicId || f.visible === false) continue;
      const isFrameOrMosaic = f.id.startsWith('plan:') || f.id.startsWith('mosaic:');
      if (!isFrameOrMosaic || f.id.split(':')[1] !== movedPlan) continue;
      if (convexPolygonsOverlap(movedCorners, this.frameGeometry(f).corners)) {
        this.onFrameMerge(movedId, f.id);
        return;
      }
    }
  }

  /**
   * Commit a drag-to-extend: convert the rubber-band rectangle to a sky region
   * (centre + angular size + PA) and hand it to the resize callback, which builds
   * the mosaic. The angular size scales the frame's single-tile FOV by the px
   * ratio (so it stays correct at the frame's location). No-op for a drag that
   * barely changed the size.
   */
  private finalizeResize(frameId: string): void {
    const draft = this.resizeDraft;
    this.resizeDraft = null;
    const f = draft ? this.fovInstances.find(x => x.id === frameId) : undefined;
    if (!draft || !f) { this.render(); return; }
    const geo = this.frameGeometry(f);
    // Px → degrees via the frame's own tile size (avoids re-inverting the projection).
    const wDeg = f.wDeg * (draft.halfW / Math.max(1e-6, geo.halfW));
    const hDeg = f.hDeg * (draft.halfH / Math.max(1e-6, geo.halfH));
    const proj = fromCanvas(draft.cx, draft.cy, this.view);
    const { ra, dec } = unproject(proj.x, proj.y);
    // PA that reproduces the frame's on-screen orientation at the new centre
    // (works whether the frame was sky- or screen-anchored).
    const paDeg = this.canvasRotDegToPa(geo.rotDeg, ra);
    this.render();
    this.onFovFrameResize?.(f.id, { centerRa: ra, centerDec: dec, wDeg, hDeg, paDeg });
  }

  private renderBackground() {
    const { ctx, view } = this;
    const theme = this.skyTheme;
    const cx = view.width / 2;
    const cy = view.height / 2;
    const maxR = Math.sqrt(view.width * view.width + view.height * view.height);

    // Solid base (always opaque — ensures a clean floor at opacity 0)
    ctx.fillStyle = theme.baseFill;
    ctx.fillRect(0, 0, view.width, view.height);

    const bgAlpha = this.backgroundOpacity * theme.bgOpacityScale;
    if (bgAlpha <= 0) return;

    ctx.save();
    ctx.globalAlpha = bgAlpha;

    // Theme gradient overlay (center → corner)
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
    for (const [offset, color] of theme.bgStops) gradient.addColorStop(offset, color);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, view.width, view.height);

    // Optional vignette: transparent from center to innerStop, darkening to the rim
    if (theme.vignette) {
      const v = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(theme.vignette.innerStop, 'rgba(0,0,0,0)');
      v.addColorStop(1, theme.vignette.color);
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, view.width, view.height);
    }
    ctx.restore();
  }

  private renderFisheyeGrid() {
    const { ctx, view } = this;
    const theme = this.skyTheme;
    const origin = toCanvas(0, 0, view);
    const hem = getHemisphere();

    // Orthographic dome: equatorial RA/Dec grid, pole at centre, equator (r = 1)
    // at the outer edge. Declination circles every 10° from the pole to the equator.
    const decStart = hem === 'south' ? -80 : 80;
    const decStep  = hem === 'south' ? 10 : -10;
    for (let dec = decStart; hem === 'south' ? dec <= 0 : dec >= 0; dec += decStep) {
      const r = Math.cos(dec * DEG2RAD) * view.scale;
      ctx.beginPath();
      ctx.arc(origin.x, origin.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = dec === 0 ? theme.gridEquatorColor : theme.gridColor;
      ctx.lineWidth = dec === 0 ? 1.5 : 0.8;
      ctx.stroke();
      // Dec label at the bottom of the circle (skip the pole and the equator edge)
      if (r > 2 && Math.abs(dec) < 89 && dec !== 0) {
        ctx.fillStyle = theme.gridLabelColor;
        ctx.font = '11px sans-serif';
        ctx.fillText(`${dec}°`, origin.x + 4, origin.y + r - 2);
      }
    }

    // RA lines every 2h (30°) from the pole out to the equator
    for (let raH = 0; raH < 24; raH += 2) {
      const raRad = raH * 15 * DEG2RAD;
      const edge = toCanvas(Math.sin(raRad), Math.cos(raRad), view); // equator (r = 1)
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.lineTo(edge.x, edge.y);
      ctx.strokeStyle = theme.gridColor;
      ctx.lineWidth = 0.8;
      ctx.stroke();
      // RA label near the equator
      const labelProj = toCanvas(0.85 * Math.sin(raRad), 0.85 * Math.cos(raRad), view);
      ctx.fillStyle = theme.gridLabelColor;
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${raH}h`, labelProj.x, labelProj.y);
    }

    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  private renderGrid() {
    const { ctx, view } = this;
    const theme = this.skyTheme;
    const origin = toCanvas(0, 0, view);
    const hem = getHemisphere();

    // Declination circles every 10°
    // North: from +80° outward to -borderLatDeg (the clip edge); South: from -80° to +borderLatDeg
    const decStart = hem === 'south' ? -80 : 80;
    const decEnd   = hem === 'south' ? this.borderLatDeg : -this.borderLatDeg;
    const decStep  = hem === 'south' ? 10 : -10;

    for (let dec = decStart; hem === 'south' ? dec <= decEnd : dec >= decEnd; dec += decStep) {
      const r = Math.tan((90 + (hem === 'south' ? dec : -dec)) / 2 * DEG2RAD) * view.scale;
      ctx.beginPath();
      ctx.arc(origin.x, origin.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = dec === 0 ? theme.gridEquatorColor : theme.gridColor;
      ctx.lineWidth = dec === 0 ? 1.5 : 0.8;
      ctx.stroke();

      // Dec label (avoid labelling the pole and the boundary)
      const label = `${dec}°`;
      const absR = r;
      if (absR > 2 && Math.abs(dec) < 89) {
        // Position label at the bottom of the circle (y = origin.y + r)
        const lx = origin.x + 4;
        const ly = origin.y + r - 2;
        ctx.fillStyle = theme.gridLabelColor;
        ctx.font = '11px sans-serif';
        ctx.fillText(label, lx, ly);
      }
    }

    // RA lines every 2h (30°)
    // maxR = projection radius of the border dec circle
    const borderRProj = Math.tan((90 + this.borderLatDeg) / 2 * DEG2RAD);
    for (let raH = 0; raH < 24; raH += 2) {
      const raDeg = raH * 15;
      const raRad = raDeg * DEG2RAD;

      const borderProjX = borderRProj * Math.sin(raRad);
      const borderProjY = borderRProj * Math.cos(raRad);
      const borderCanvas = toCanvas(borderProjX, borderProjY, view);

      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.lineTo(borderCanvas.x, borderCanvas.y);
      ctx.strokeStyle = theme.gridColor;
      ctx.lineWidth = 0.8;
      ctx.stroke();

      // RA label near the equator
      // Equator is at r=1 in projection units, but use a slightly inner position
      const labelProj = toCanvas(0.85 * Math.sin(raRad), 0.85 * Math.cos(raRad), view);
      const lx = labelProj.x;
      const ly = labelProj.y;
      ctx.fillStyle = theme.gridLabelColor;
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${raH}h`, lx, ly);
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    }
  }

  private renderConstellationLines() {
    const { ctx, view } = this;
    const lines = getConstellationLines(this.constellationStyle);

    ctx.strokeStyle = this.skyTheme.constellationLineColor;
    ctx.lineWidth = 1;

    for (const constellation of lines) {
      for (const segment of constellation.segments) {
        if (segment.length < 2) continue;

        ctx.beginPath();
        // In fisheye mode, points below the horizon project to (1e6, 1e6).
        // Lift the pen at those points so a line doesn't streak across the sky.
        let penDown = false;
        for (let i = 0; i < segment.length; i++) {
          const p = project(segment[i][0], segment[i][1]);
          if (p.x >= 1e5) { penDown = false; continue; }
          const c = toCanvas(p.x, p.y, view);
          if (penDown) {
            ctx.lineTo(c.x, c.y);
          } else {
            ctx.moveTo(c.x, c.y);
            penDown = true;
          }
        }

        ctx.stroke();
      }
    }
  }

  private renderStars() {
    const { ctx, view } = this;
    // Stars render at full opacity (not dimmed by skyOpacity like the rest of the
    // sky), so their opaque cores fully occlude constellation/grid lines behind
    // them instead of letting the line bleed through the middle of the star.
    const prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = 1;
    const stars = getStars();
    const theme = this.skyTheme;
    // Pan-invariant magnitude cutoff for this zoom + canvas (see render-budget.ts).
    // A star renders iff its magnitude is at or below this threshold, regardless of what
    // else is on screen — so panning never makes stars pop into the static part of the
    // view.
    const maxMag = this.starMagThreshold();

    // The sprite atlas (offscreen canvas per quantized mag/bv) is expensive to build, so
    // we don't rebuild it on every frame. A fast zoom changes scale by >1 bucket per
    // frame, which would churn hundreds of canvases per frame and drive the GC. Between
    // rebuilds the frozen sprites are scaled to the live zoom with drawImage (cheap).
    //
    // Rebuild a crisp atlas: always at rest / when empty; during a gesture, only once the
    // live zoom has drifted past ATLAS_REBUILD_RATIO from the frozen atlas. Throttling by
    // scale drift (not time) bounds the upscale — and thus the pixelation — directly, and
    // is self-limiting: each rebuild resets the drift to ~1, so a continuous zoom rebuilds
    // once per ~1.3× step regardless of frame rate (no time-floor feedback loop).
    const atlasScale = atlasScaleBucket(view.scale);
    const atlasMaxMag = Math.round(maxMag * 10) / 10;
    const atlasStale = atlasScale !== this.starSpriteScale || atlasMaxMag !== this.starSpriteMaxMag;
    // How much the frozen sprites would be scaled to track the current zoom.
    const liveRatio = this.starSpriteScale > 0 ? Math.sqrt(view.scale / this.starSpriteScale) : 1;
    const drifted = liveRatio > SkyMap.ATLAS_REBUILD_RATIO || liveRatio < 1 / SkyMap.ATLAS_REBUILD_RATIO;
    if (atlasStale && (!this.interacting || this.starSprites.size === 0 || drifted)) {
      this.starSprites.clear();
      this.starSpriteScale = atlasScale;
      this.starSpriteMaxMag = atlasMaxMag;
    }
    // Just-rebuilt frames draw crisp 1:1 (bucket matches); between rebuilds, scale the
    // frozen sprites by the radius ratio (≈ √ of the scale ratio, matching starRadius'
    // curve). At rest and during pan the bucket matches, so this stays 1.
    const frozenScale = this.starSpriteScale !== atlasScale;
    const spriteScale = frozenScale && this.starSpriteScale > 0
      ? Math.sqrt(view.scale / this.starSpriteScale)
      : 1;

    for (const star of stars) {
      // Always include the highlighted star.
      const isHighlighted = this.highlightedStar === star.hip;

      if (!isHighlighted) {
        if (star.mag > maxMag) continue;
        // Dec pre-filter: skip objects clearly outside the border (stereo only — in
        // fisheye the far hemisphere is clipped by project() returning off-canvas).
        if (!this.fisheyeMode) {
          if (this.hemisphere === 'north' && star.dec < -(this.borderLatDeg + 2)) continue;
          if (this.hemisphere === 'south' && star.dec > +(this.borderLatDeg + 2)) continue;
        }
      }

      projectCached(star);
      const c = toCanvas(star._px!, star._py!, view);

      // Skip if off-screen (with margin)
      if (c.x < -20 || c.x > view.width + 20 || c.y < -20 || c.y > view.height + 20) {
        continue;
      }

      if (isHighlighted) {
        // Drawn live (not via the atlas): rare, uses estab=1, and gets a ring.
        const paint = computeStarPaint(star.mag, star.bv, view.scale, maxMag, theme, true);
        paintStar(ctx, c.x, c.y, paint);
        ctx.strokeStyle = 'rgba(192, 120, 48, 0.85)';
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(c.x, c.y, paint.radius + 4, 0, Math.PI * 2);
        ctx.stroke();
        continue;
      }

      // Quantize (mag, bv) to a sprite bucket: 0.25-mag and ~1/12 B-V steps.
      const magKey = Math.round(star.mag * 4);
      const bvKey = Math.round((Math.max(-0.4, Math.min(2.0, star.bv)) + 0.4) * 12);
      const key = magKey * 100 + bvKey;
      let sprite = this.starSprites.get(key);
      if (sprite === undefined) {
        // Build at the atlas's frozen scale/maxMag so a sprite minted mid-gesture (a
        // newly-appeared bucket) matches the rest of the atlas and scales identically.
        const paint = computeStarPaint(star.mag, star.bv, this.starSpriteScale, this.starSpriteMaxMag, theme, false);
        sprite = this.buildStarSprite(paint);
        this.starSprites.set(key, sprite);
      }
      if (spriteScale === 1) {
        ctx.drawImage(sprite.canvas, c.x - sprite.half, c.y - sprite.half);
      } else {
        const h = sprite.half * spriteScale;
        ctx.drawImage(sprite.canvas, c.x - h, c.y - h, sprite.canvas.width * spriteScale, sprite.canvas.height * spriteScale);
      }
    }

    ctx.globalAlpha = prevAlpha;
  }

  /** Render one star's sprite (centred) into an offscreen canvas sized to its extent. */
  private buildStarSprite(paint: StarPaint): { canvas: HTMLCanvasElement; half: number } {
    const extent = paint.glowAlpha > 0.01 ? paint.glowR : paint.radius;
    const half = Math.ceil(extent) + 1;   // +1px so the soft rim isn't clipped
    const canvas = document.createElement('canvas');
    canvas.width = half * 2;
    canvas.height = half * 2;
    const sctx = canvas.getContext('2d')!;
    paintStar(sctx, half, half, paint);
    return { canvas, half };
  }

  private renderStarLabels() {
    const { ctx, view } = this;
    const stars = getStars();

    ctx.font = '10px sans-serif';
    ctx.fillStyle = 'rgba(195, 180, 160, 0.55)';
    ctx.textBaseline = 'middle';

    for (const star of stars) {
      if (star.mag > 3 || !star.name) continue;

      projectCached(star);
      const c = toCanvas(star._px!, star._py!, view);

      if (c.x < -50 || c.x > view.width + 50 || c.y < -50 || c.y > view.height + 50) {
        continue;
      }

      const r = starRadius(star.mag, view.scale, this.skyTheme.brightZoomBoost);
      ctx.fillText(star.name, c.x + r + 3, c.y);
    }

    ctx.textBaseline = 'alphabetic';
  }

  /**
   * Single source of truth for which DSOs to draw this frame: applies the
   * type/catalog/viewport filters and the container-size gate (hide inner objects until
   * their container renders large enough), then keeps candidates whose precomputed
   * render `priority` is below a pan-invariant, zoom-derived threshold (the density
   * budget). `priority` is rating-weighted, so a low budget shows the brightest/most
   * famous DSOs and a high budget fills the map with fainter ones — no magnitude gate.
   * Cached per frame so renderDSOs, renderDSOLabels and isDSORendered all agree.
   */
  /**
   * (Re)build the all-DSO position index used for viewport culling. Positions depend
   * only on the projection generation (hemisphere/mode/coordinate override), so this
   * rebuilds at most once per such change, never per frame. Also records the largest
   * on-border DSO body radius so the viewport query can include big objects whose
   * centre sits just off-screen.
   */
  private ensureDsoAllIndex(): void {
    const gen = getProjectionGeneration();
    if (this.dsoAllIndexGen === gen) return;
    this.dsoAllIndex.clear();
    this.dsoGiants = [];
    let maxBody = 0;
    for (const dso of getDSOs()) {
      projectCached(dso);
      // Body radius (projection units) = rx / scale, independent of zoom. A handful of
      // very large objects (Barnard's Loop, big LBN/LDN clouds) would force a wide query
      // margin for everyone, so they bypass the index and are always considered.
      const near = dso._px! * dso._px! + dso._py! * dso._py! < 4; // exclude far hemisphere
      const body = near ? ((dso.majAxis ?? 1) / 2 / 60) * DEG2RAD / (2 * dsoSizeCos2(dso)) : 0;
      if (body > DSO_GIANT_BODY_PU) {
        this.dsoGiants.push(dso);
      } else {
        this.dsoAllIndex.insert(dso, dso._px!, dso._py!);
        if (body > maxBody) maxBody = body;
      }
    }
    this.dsoMaxBodyPU = maxBody;
    this.dsoAllIndexGen = gen;
  }

  private selectRenderedDSOs(): DSO[] {
    if (this.cachedSelectedDSOs) return this.cachedSelectedDSOs;
    const { view } = this;

    // Viewport cull: query the position index for DSOs whose centre is within the
    // visible disc plus a margin for the largest body and the off-screen render margin.
    // This replaces a full scan of all ~12k DSOs every frame with a bounded query —
    // a big win when zoomed in (small viewport), a no-op cost when zoomed out.
    this.ensureDsoAllIndex();
    const queryR = Math.hypot(view.width / 2, view.height / 2) / view.scale
      + this.dsoMaxBodyPU + 20 / view.scale;
    const nearby = this.dsoAllIndex.collect(view.centerX, view.centerY, queryR);

    const candidates: (SelectableDSO & { dso: DSO })[] = [];
    // The spatial query covers normal-sized objects; the few giant DSOs (body larger
    // than the query margin) live outside the index and are always considered, so the
    // margin can stay tight without ever missing a large object near the edge.
    for (const src of [nearby, this.dsoGiants]) for (const dso of src) {
      const isHighlighted = this.highlightedDSO === dso.id;

      if (!isHighlighted) {
        if (!this.visibleDSOTypes.has(dso.type)) continue;
        const cat = dso.catalog;
        if (cat && !this.visibleDSOCatalogs.has(cat)) continue;
        // Dec pre-filter: skip objects clearly outside the border (stereo only — in
        // fisheye the far hemisphere is clipped by project() returning off-canvas).
        if (!this.fisheyeMode) {
          if (this.hemisphere === 'north' && dso.dec < -(this.borderLatDeg + 2)) continue;
          if (this.hemisphere === 'south' && dso.dec > +(this.borderLatDeg + 2)) continue;
        }
        // Container gate: hide an inner object until its container renders large
        // enough on screen (so the container stays clean and clickable when zoomed out).
        if (dso.containerId && dso.containerId !== this.highlightedDSO) {
          const container = getDSOById(dso.containerId);
          if (container) {
            const cRx = Math.max(2, angularSizeToCanvasPx((container.majAxis ?? 1) / 2, container.dec, view.scale, dsoSizeCos2(container)));
            if (cRx < DSO_CONTAINER_VISIBLE_RADIUS_PX) continue;
          }
        }
      }

      projectCached(dso);
      const c = toCanvas(dso._px!, dso._py!, view);
      const majorArcmin = dso.majAxis ?? 1;
      const rx = Math.max(2, angularSizeToCanvasPx(majorArcmin / 2, dso.dec, view.scale, dsoSizeCos2(dso)));
      const margin = rx + 20;
      if (c.x < -margin || c.x > view.width + margin || c.y < -margin || c.y > view.height + margin) {
        continue;
      }

      candidates.push({ id: dso.id, priority: dso.priority, isHighlighted, dso });
    }

    const selected = selectDSOsToRender(candidates, this.dsoPriorityThreshold()).map(s => s.dso);
    this.cachedSelectedDSOs = selected;
    this.cachedSelectedDSOIds = new Set(selected.map(d => d.id));
    return selected;
  }

  private renderDSOs() {
    const { ctx, view } = this;

    // Render the selected DSOs
    for (const dso of this.selectRenderedDSOs()) {
      projectCached(dso);
      const c = toCanvas(dso._px!, dso._py!, view);

      const majorArcmin = dso.majAxis ?? 1;
      const minorArcmin = dso.minAxis ?? majorArcmin;
      const cos2 = dsoSizeCos2(dso);
      const rx = Math.max(2, angularSizeToCanvasPx(majorArcmin / 2, dso.dec, view.scale, cos2));
      const ry = Math.max(2, angularSizeToCanvasPx(minorArcmin / 2, dso.dec, view.scale, cos2));
      const angle = dsoCanvasAngle(dso.pa, dso.ra, view.rotationDeg);

      // Opacity based on magnitude
      const mag = dso.mag ?? 10;
      const opacity = Math.min(1, Math.max(0.3, 1 - (mag - 4) * 0.07));

      ctx.save();
      ctx.globalAlpha = opacity * this.skyOpacity;
      ctx.translate(c.x, c.y);
      ctx.rotate(angle);

      switch (dso.type) {
        case 'GxS':
        case 'Gx': {
          // Spiral / unclassified galaxy: filled ellipse, golden gradient
          const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
          grad.addColorStop(0, 'rgba(220, 180, 100, 0.8)');
          grad.addColorStop(0.5, 'rgba(180, 140, 70, 0.5)');
          grad.addColorStop(1, 'rgba(150, 100, 40, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.scale(1, ry / rx);
          ctx.arc(0, 0, rx, 0, Math.PI * 2);
          ctx.fill();
          ctx.scale(1, rx / ry);
          ctx.strokeStyle = 'rgba(220, 180, 100, 0.6)';
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.scale(1, ry / rx);
          ctx.arc(0, 0, rx, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'GxE': {
          // Elliptical galaxy: rounder, bluer-white gradient
          const eRad = Math.max(rx, ry);
          const eGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, eRad);
          eGrad.addColorStop(0, 'rgba(210, 210, 255, 0.8)');
          eGrad.addColorStop(0.5, 'rgba(160, 160, 220, 0.4)');
          eGrad.addColorStop(1, 'rgba(120, 120, 180, 0)');
          ctx.fillStyle = eGrad;
          ctx.beginPath();
          ctx.scale(1, ry / rx);
          ctx.arc(0, 0, rx, 0, Math.PI * 2);
          ctx.fill();
          ctx.scale(1, rx / ry);
          ctx.strokeStyle = 'rgba(180, 180, 240, 0.5)';
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.scale(1, ry / rx);
          ctx.arc(0, 0, rx, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'GxI': {
          // Irregular galaxy: slightly greenish/teal, amorphous (no rotation)
          const iRad = rx;
          const iGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, iRad);
          iGrad.addColorStop(0, 'rgba(140, 230, 180, 0.7)');
          iGrad.addColorStop(0.5, 'rgba(100, 180, 140, 0.35)');
          iGrad.addColorStop(1, 'rgba(60, 140, 100, 0)');
          ctx.fillStyle = iGrad;
          ctx.beginPath();
          ctx.arc(0, 0, iRad, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(100, 200, 150, 0.5)';
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.arc(0, 0, iRad, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'OC': {
          // Open cluster: dashed circle, warm neutral
          ctx.strokeStyle = 'rgba(200, 185, 160, 0.6)';
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.arc(0, 0, rx, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          break;
        }
        case 'GC': {
          // Globular cluster: filled circle with gradient + cross
          const gcR = rx;
          const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, gcR);
          grad.addColorStop(0, 'rgba(255, 220, 100, 0.7)');
          grad.addColorStop(0.6, 'rgba(220, 160, 60, 0.4)');
          grad.addColorStop(1, 'rgba(180, 120, 30, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(0, 0, gcR, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(255, 200, 80, 0.6)';
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.arc(0, 0, gcR, 0, Math.PI * 2);
          ctx.stroke();
          // Cross
          ctx.beginPath();
          ctx.moveTo(-gcR, 0); ctx.lineTo(gcR, 0);
          ctx.moveTo(0, -gcR); ctx.lineTo(0, gcR);
          ctx.stroke();
          break;
        }
        case 'EN': {
          // Emission nebula: reddish ellipse gradient
          const enGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
          enGrad.addColorStop(0, 'rgba(255, 80, 80, 0.4)');
          enGrad.addColorStop(0.5, 'rgba(200, 50, 80, 0.2)');
          enGrad.addColorStop(1, 'rgba(180, 30, 60, 0)');
          ctx.fillStyle = enGrad;
          ctx.beginPath();
          ctx.scale(1, ry / rx);
          ctx.arc(0, 0, rx, 0, Math.PI * 2);
          ctx.fill();
          ctx.scale(1, rx / ry);
          ctx.strokeStyle = 'rgba(220, 80, 80, 0.4)';
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.scale(1, ry / rx);
          ctx.arc(0, 0, rx, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'RN': {
          // Reflection nebula: cool neutral ellipse
          const rnGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
          rnGrad.addColorStop(0, 'rgba(100, 115, 140, 0.35)');
          rnGrad.addColorStop(0.5, 'rgba(80, 95, 120, 0.15)');
          rnGrad.addColorStop(1, 'rgba(60, 75, 100, 0)');
          ctx.fillStyle = rnGrad;
          ctx.beginPath();
          ctx.scale(1, ry / rx);
          ctx.arc(0, 0, rx, 0, Math.PI * 2);
          ctx.fill();
          ctx.scale(1, rx / ry);
          ctx.strokeStyle = 'rgba(160, 175, 185, 0.45)';
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.scale(1, ry / rx);
          ctx.arc(0, 0, rx, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'PN': {
          // Planetary nebula: double circle, blue-cyan
          ctx.strokeStyle = 'rgba(80, 200, 220, 0.8)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(0, 0, rx, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(80, 200, 220, 0.5)';
          ctx.beginPath();
          ctx.arc(0, 0, rx * 0.4, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'SNR': {
          // Supernova remnant: green-teal ellipse
          const snrGrad = ctx.createRadialGradient(0, 0, rx * 0.6, 0, 0, rx);
          snrGrad.addColorStop(0, 'rgba(80, 200, 150, 0)');
          snrGrad.addColorStop(0.7, 'rgba(80, 200, 150, 0.2)');
          snrGrad.addColorStop(1, 'rgba(60, 180, 120, 0.5)');
          ctx.fillStyle = snrGrad;
          ctx.beginPath();
          ctx.scale(1, ry / rx);
          ctx.arc(0, 0, rx, 0, Math.PI * 2);
          ctx.fill();
          ctx.scale(1, rx / ry);
          ctx.strokeStyle = 'rgba(80, 200, 150, 0.5)';
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.scale(1, ry / rx);
          ctx.arc(0, 0, rx, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'DN': {
          // Dark nebula: simple dark outline
          ctx.strokeStyle = 'rgba(120, 120, 140, 0.5)';
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.scale(1, ry / rx);
          ctx.arc(0, 0, rx, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        default: {
          // Unknown: simple circle
          ctx.strokeStyle = 'rgba(160, 160, 160, 0.4)';
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.arc(0, 0, rx, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
      }

      // Highlight indicator for searched DSO
      if (dso.id === this.highlightedDSO) {
        ctx.strokeStyle = 'rgba(192, 120, 48, 0.85)';
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.scale(1, ry / rx);
        ctx.arc(0, 0, rx + 4, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  private renderDSOLabels() {
    const { ctx, view } = this;

    const TYPE_COLORS: Record<string, string> = {
      'Gx':  'rgba(220, 180, 100, 0.8)',
      'OC':  'rgba(200, 185, 160, 0.8)',
      'GC':  'rgba(255, 200, 80, 0.8)',
      'EN':  'rgba(220, 100, 100, 0.8)',
      'RN':  'rgba(160, 175, 185, 0.75)',
      'PN':  'rgba(80, 200, 220, 0.9)',
      'SNR': 'rgba(80, 200, 150, 0.8)',
      'DN':  'rgba(120, 120, 140, 0.6)',
      '?':   'rgba(160, 160, 160, 0.6)',
    };

    ctx.textBaseline = 'middle';

    // Render labels for exactly the DSOs drawn this frame (shared selection).
    for (const dso of this.selectRenderedDSOs()) {
      const isMess = dso.id.startsWith('M') && !dso.id.startsWith('M0');
      const majorArcmin = dso.majAxis ?? 1;
      const rx = angularSizeToCanvasPx(majorArcmin / 2, dso.dec, view.scale, dsoSizeCos2(dso));

      // Label visibility rules
      if (isMess && view.scale <= 100) continue;
      if (!isMess && (view.scale <= 300 || rx <= 4)) continue;

      projectCached(dso);
      const c = toCanvas(dso._px!, dso._py!, view);

      const label = isMess ? dso.id
        : dso.id.startsWith('LPN-') ? (dso.displayName || dso.id.replace(/^LPN-/, ''))
        : dso.id.replace('NGC', 'NGC ').replace(/^IC(\d)/, 'IC $1')
               .replace('LBN', 'LBN ').replace('LDN', 'LDN ').replace('SH2-', 'Sh2-').replace('vdB', 'vdB ').replace(/^(Abell)(\d)/, '$1 $2').replace(/^(Barnard)(\d)/, '$1 $2');
      ctx.font = '9px sans-serif';
      ctx.fillStyle = TYPE_COLORS[dso.type] || 'rgba(160, 160, 160, 0.7)';
      ctx.fillText(label, c.x + Math.max(2, rx) + 2, c.y);
    }

    ctx.textBaseline = 'alphabetic';
  }

  private renderConstellationNames() {
    const { ctx, view } = this;
    const infos = getConstellationInfos();

    ctx.font = '11px sans-serif';
    ctx.fillStyle = 'rgba(185, 170, 155, 0.4)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const info of infos) {
      const p = project(info.ra, info.dec);
      const c = toCanvas(p.x, p.y, view);

      if (c.x < -100 || c.x > view.width + 100 || c.y < -100 || c.y > view.height + 100) {
        continue;
      }

      ctx.fillText(info.displayName.toUpperCase(), c.x, c.y);
    }

    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }
}
