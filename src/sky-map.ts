import type { Star, DSO, ViewState, Point, ConstellationStyle } from './types';
import { project, toCanvas, fromCanvas, unproject, setHemisphere, getHemisphere, fitScaleForBorderCircle } from './projection';
import { getStars, getConstellationLines, getConstellationInfos, loadConstellationStyle } from './star-catalog';
import { getDSOs, getDSOCatalog } from './dso-catalog';
import { frameTargetDso } from './fov-frame-target';
import { SpatialIndex } from './spatial-index';
import { paToCanvasRotationDeg, canvasRotationToPaDeg } from './frame-orientation';
import {
  isNearPolygonBorder,
  isNearHandle,
  rotateHandlePos,
  canvasRotationDegFromCursor,
} from './fov-frame-geometry';
import pinSvgRaw from './icons/pin.svg?raw';
import { computeFovTargetScale } from './gear-presets';

const DEG2RAD = Math.PI / 180;

/** Pushpin glyph path (24×24 box) extracted from the shared icon asset. */
const PIN_PATH_D = pinSvgRaw.match(/\bd="([^"]+)"/)?.[1] ?? '';
/** Lazily-built Path2D for the pushpin glyph. Lazy so module load does not
 * require a DOM (Path2D is absent in the unit-test environment). */
let pinPath2D: Path2D | null = null;
function getPinPath(): Path2D {
  return (pinPath2D ??= new Path2D(PIN_PATH_D));
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

  if (bv < 0) {
    const t = (bv + 0.4) / 0.4;
    r = 0.61 + 0.39 * t;
    g = 0.70 + 0.30 * t;
    b = 1.0;
  } else if (bv < 0.4) {
    const t = bv / 0.4;
    r = 1.0;
    g = 1.0 - 0.08 * t;
    b = 1.0 - 0.22 * t;
  } else if (bv < 0.8) {
    const t = (bv - 0.4) / 0.4;
    r = 1.0;
    g = 0.92 - 0.14 * t;
    b = 0.78 - 0.26 * t;
  } else if (bv < 1.2) {
    const t = (bv - 0.8) / 0.4;
    r = 1.0;
    g = 0.78 - 0.11 * t;
    b = 0.52 - 0.12 * t;
  } else {
    const t = Math.min((bv - 1.2) / 0.8, 1);
    r = 1.0;
    g = 0.67 - 0.09 * t;
    b = 0.40 - 0.05 * t;
  }

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function starRadius(mag: number, scale: number): number {
  const base = Math.max(0.5, 3.5 - mag * 0.5);
  const zoomFactor = Math.min(1, Math.sqrt(scale / 400));
  return Math.max(1.5, base * zoomFactor);
}

function computeMaxMag(scale: number): number {
  const raw = 6 + Math.log2(scale / 200);
  return Math.max(6, raw);
}

export function normalizeRotationDeg(deg: number): number {
  let normalized = ((deg % 360) + 360) % 360;
  if (normalized > 180) normalized -= 360;
  return normalized;
}

// ─── DSO rendering helpers ──────────────────────────────────────────────────

/** Convert angular size (arcmin) to canvas pixels accounting for stereographic scale */
function angularSizeToCanvasPx(arcmin: number, decDeg: number, scale: number): number {
  const colatitude = getHemisphere() === 'south' ? 90 + decDeg : 90 - decDeg;
  const theta = colatitude * Math.PI / 180;
  const cos2 = Math.cos(theta / 2) ** 2;
  const rad = (arcmin / 60) * Math.PI / 180;
  return (rad / (2 * cos2)) * scale;
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
  private maxMagOverride: number | null = null;
  private visibleDSOTypes: Set<string> = new Set(['GxS', 'GxE', 'GxI', 'Gx', 'OC', 'GC', 'EN', 'RN', 'PN', 'SNR', 'DN', '?']);
  private visibleDSOCatalogs: Set<string> = new Set(['M', 'NGC', 'IC', 'SH2']);
  private showGrid = true;
  private showStarLabels = true;
  private showDSOLabels = true;
  private skyOpacity = 0.5;
  private backgroundOpacity = 1.0;
  private maxStarCount = 2000;
  private maxDSOCount = 500;
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
  private frameDrag: { id: string; mode: 'move' | 'rotate' } | null = null;

  // Spatial indexes for fast hover detection
  private starIndex = new SpatialIndex<Star>(0.02);
  private dsoIndex = new SpatialIndex<DSO>(0.02);
  private starIndexMaxMag = -1;
  private dsoIndexMaxMag = -99999; // Sentinel value meaning "not initialized"

  // Pan state
  private isPanning = false;
  private panStartX = 0;
  private panStartY = 0;
  private panAnchorProjX = 0;
  private panAnchorProjY = 0;

  // Animation
  private animationId: number | null = null;

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

  // Interaction control (disabled when another view is active)
  private interactionEnabled = true;

  // Hemisphere & border
  private hemisphere: 'north' | 'south' = 'north';
  private borderLatDeg = 45;

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
    this.render();
  }

  setShowStars(show: boolean) { this.showStars = show; this.render(); }
  setShowConstellationLines(show: boolean) { this.showConstellationLines = show; this.render(); }
  setShowConstellationNames(show: boolean) { this.showConstellationNames = show; this.render(); }

  async setConstellationStyle(style: ConstellationStyle): Promise<void> {
    await loadConstellationStyle(style);
    this.constellationStyle = style;
    this.render();
  }

  getConstellationStyle(): ConstellationStyle {
    return this.constellationStyle;
  }

  /** The underlying canvas element. Backing store is devicePixelRatio-scaled (see resize()). */
  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }
  setMaxMag(mag: number | null) { this.maxMagOverride = mag; this.render(); }
  setMaxStarCount(count: number) { this.maxStarCount = count; this.render(); }
  setMaxDSOCount(count: number) { this.maxDSOCount = count; this.render(); }
  setHighlightedDSO(dsoId: string | null) { this.highlightedDSO = dsoId; this.dsoIndexMaxMag = -99999; this.render(); }
  setHighlightedStar(hip: number | null) { this.highlightedStar = hip; this.starIndexMaxMag = -1; this.render(); }
  setVisibleDSOTypes(types: Set<string>) { this.visibleDSOTypes = types; this.dsoIndexMaxMag = -99999; this.render(); }
  setVisibleDSOCatalogs(catalogs: Set<string>) { this.visibleDSOCatalogs = catalogs; this.dsoIndexMaxMag = -99999; this.render(); }
  setShowGrid(show: boolean) { this.showGrid = show; this.render(); }
  setShowStarLabels(show: boolean) { this.showStarLabels = show; this.render(); }
  setShowDSOLabels(show: boolean) { this.showDSOLabels = show; this.render(); }
  setSkyOpacity(v: number) { this.skyOpacity = v; this.render(); }
  setBackgroundOpacity(v: number) { this.backgroundOpacity = v; this.render(); }
  setPhotoOutlines(outlines: PhotoOutline[]) { this.photoOutlines = outlines; }
  setShowPhotoOutlines(show: boolean) { this.showPhotoOutlines = show; this.render(); }
  setFovFrames(frames: FovFrameSpec[]) { this.fovFrameSpecs = frames; this.render(); }
  setFovRotationDeg(deg: number) { this.fovRotationDeg = deg; this.render(); }

  /** Replace the interactive frame instances and re-render. */
  setFovInstances(frames: RenderableFrame[]) { this.fovInstances = frames; this.render(); }
  /** Current interactive frame instances (for save/restore around off-screen renders). */
  getFovInstances(): RenderableFrame[] { return this.fovInstances; }
  setOnFovInstanceSelect(cb: (id: string | null) => void) { this.onFovInstanceSelect = cb; }
  setOnFovInstanceChange(cb: (id: string, change: FovFrameChange) => void) { this.onFovInstanceChange = cb; }
  setOnPhotoClick(cb: (photoName: string) => void) { this.onPhotoClick = cb; }
  setOnDSOClick(cb: (dso: DSO) => void) { this.onDSOClick = cb; }

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
    this.render();
  }

  /** Update just the border latitude without switching hemisphere. */
  setBorderLatDeg(deg: number) {
    this.borderLatDeg = deg;
    // Invalidate spatial indexes so border check on hover stays consistent
    this.starIndexMaxMag = -1;
    this.dsoIndexMaxMag = -99999;
    this.render();
  }

  zoomBy(factor: number) {
    this.view.scale = Math.max(50, Math.min(100000, this.view.scale * factor));
    this.onViewChange?.();
    this.render();
  }

  rotateByDeg(deltaDeg: number) {
    this.setRotationDeg(this.view.rotationDeg + deltaDeg);
  }

  setRotationDeg(rotationDeg: number) {
    this.view.rotationDeg = normalizeRotationDeg(rotationDeg);
    this.onViewChange?.();
    this.render();
  }

  resetRotation() {
    this.setRotationDeg(0);
  }

  panBy(dxPx: number, dyPx: number) {
    this.view.centerX += dxPx / this.view.scale;
    this.view.centerY -= dyPx / this.view.scale;
    this.onViewChange?.();
    this.render();
  }

  getShowGrid() { return this.showGrid; }
  getEffectiveMaxMag(): number { return this.maxMagOverride ?? computeMaxMag(this.view.scale); }

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
      this.render();

      if (t < 1) {
        this.animationId = requestAnimationFrame(step);
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
    if (layers) Object.assign(this, layers);
    tctx.save();
    tctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
    try {
      this.render();
    } finally {
      tctx.restore();
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

    this.onViewChange?.();
    this.render();
  }

  private buildStarIndex(maxMag: number) {
    if (maxMag === this.starIndexMaxMag) return;
    this.starIndexMaxMag = maxMag;
    this.starIndex.clear();
    for (const star of getStars()) {
      if (star.mag > maxMag) continue;
      const p = project(star.ra, star.dec);
      this.starIndex.insert(star, p.x, p.y);
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
        const cat = getDSOCatalog(dso.id);
        if (cat && !this.visibleDSOCatalogs.has(cat)) continue;
        if (maxMag !== null && dso.mag !== null && dso.mag > maxMag) continue;
        if (dso.mag === null && maxMag !== null) continue;
      }
      
      const p = project(dso.ra, dso.dec);
      this.dsoIndex.insert(dso, p.x, p.y);
    }
  }

  private findClosestStar(mx: number, my: number): Star | null {
    const maxMag = this.maxMagOverride ?? computeMaxMag(this.view.scale);
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
      this.render();
    }) as EventListener, { passive: false });

    // Pan with mouse drag
    this.addEvent(this.canvas, 'mousedown', ((e: MouseEvent) => {
      this.cancelAnimation();
      if (e.button === 0) {
        const rectF = this.canvas.getBoundingClientRect();
        if (this.handleFrameMouseDown(e.clientX - rectF.left, e.clientY - rectF.top)) {
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
        this.render();
      } else {
        if (!this.interactionEnabled) return;
        // Hover detection
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        // Check if mouse is over the side panel by checking if it's on the right side
        const sidePanel = document.getElementById('side-panel');
        const isOverPanel = sidePanel && !sidePanel.classList.contains('collapsed') && 
                            e.clientX > window.innerWidth - 280; // Panel is 280px wide on the right

        if (mx >= 0 && my >= 0 && mx <= this.view.width && my <= this.view.height && !isOverPanel) {
          this.handleHover(mx, my, e.clientX, e.clientY);
        } else if (isOverPanel) {
          // Hide tooltips when mouse is over side panel
          if (this.onStarHover) {
            this.onStarHover(null, 0, 0);
          }
        }
      }
    }) as EventListener);

    this.addEvent(window, 'mouseup', ((e: MouseEvent) => {
      if (this.frameDrag) {
        this.frameDrag = null;
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

        // DSO click: fire alongside photo click if a DSO is under the cursor
        if (!this.pickingMode && !moved && this.onDSOClick && this.hoveredDSO) {
          this.onDSOClick(this.hoveredDSO);
        }
      }
    }) as EventListener);

    // Escape exits picking mode, or deselects the active frame.
    this.addEvent(window, 'keydown', ((e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (this.pickingMode) {
        this.exitPickingMode();
      } else if (this.fovInstances.some(f => f.active)) {
        this.selectFrame(null);
      }
    }) as EventListener);
  }

  destroy() {
    this.cancelAnimation();
    for (const { target, event, handler } of this.boundHandlers) {
      target.removeEventListener(event, handler);
    }
    this.boundHandlers = [];
  }

  setInteractionEnabled(enabled: boolean): void {
    this.interactionEnabled = enabled;
    if (!enabled) {
      this.onStarHover?.(null, 0, 0);
      this.onDSOHover?.(null, 0, 0);
    }
  }

  private findClosestDSO(mx: number, my: number): DSO | null {
    if (!this.showDSOs) return null;
    // Handle Infinity as no limit, same as renderDSOs
    let maxMag: number | null;
    if (this.maxMagOverride === Infinity) {
      maxMag = null;
    } else if (this.maxMagOverride !== null) {
      maxMag = this.maxMagOverride + 4;
    } else {
      maxMag = computeMaxMag(this.view.scale) + 4;
    }
    this.buildDSOIndex(maxMag);
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
    let maxMag: number | null;
    if (this.maxMagOverride === Infinity) maxMag = null;
    else if (this.maxMagOverride !== null) maxMag = this.maxMagOverride + 4;
    else maxMag = computeMaxMag(this.view.scale) + 4;
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
    
    // Check magnitude filter
    let maxMag: number | null;
    if (this.maxMagOverride === Infinity) {
      maxMag = null;
    } else if (this.maxMagOverride !== null) {
      maxMag = this.maxMagOverride;
    } else {
      maxMag = computeMaxMag(view.scale);
    }
    if (maxMag !== null && star.mag > maxMag) return false;

    // Check viewport bounds
    const p = project(star.ra, star.dec);
    const c = toCanvas(p.x, p.y, view);
    if (c.x < -20 || c.x > view.width + 20 || c.y < -20 || c.y > view.height + 20) {
      return false;
    }

    // Check if it's in the top-N brightest stars in viewport
    const visibleStars: Star[] = [];
    for (const s of getStars()) {
      if (maxMag !== null && s.mag > maxMag) continue;
      const sp = project(s.ra, s.dec);
      const sc = toCanvas(sp.x, sp.y, view);
      if (sc.x < -20 || sc.x > view.width + 20 || sc.y < -20 || sc.y > view.height + 20) {
        continue;
      }
      visibleStars.push(s);
    }

    if (visibleStars.length <= this.maxStarCount) {
      return true; // No filtering needed
    }

    // Check if this star is in top-N brightest
    const topStars = visibleStars
      .sort((a, b) => a.mag - b.mag)
      .slice(0, this.maxStarCount);
    return topStars.includes(star);
  }

  /**
   * Check if a DSO would actually be rendered given current viewport and limits.
   * Replicates the filtering logic from renderDSOs().
   */
  private isDSORendered(dso: DSO): boolean {
    const { view } = this;
    
    const isHighlighted = this.highlightedDSO === dso.id;
    
    // Check type/catalog filters
    if (!isHighlighted) {
      if (!this.visibleDSOTypes.has(dso.type)) return false;
      const cat = getDSOCatalog(dso.id);
      if (cat && !this.visibleDSOCatalogs.has(cat)) return false;
    }
    
    // Check magnitude filter
    let maxMag: number | null;
    if (this.maxMagOverride === Infinity) {
      maxMag = null;
    } else if (this.maxMagOverride !== null) {
      maxMag = this.maxMagOverride;
    } else {
      maxMag = 6 + Math.log2(view.scale / 200) * 1.5;
    }
    if (!isHighlighted) {
      if (maxMag !== null && dso.mag !== null && dso.mag > maxMag) return false;
      if (dso.mag === null && maxMag !== null) return false;
    }

    // Check viewport bounds
    const p = project(dso.ra, dso.dec);
    const c = toCanvas(p.x, p.y, view);
    const majorArcmin = dso.majAxis ?? 1;
    const rx = Math.max(2, angularSizeToCanvasPx(majorArcmin / 2, dso.dec, view.scale));
    const margin = rx + 20;
    if (c.x < -margin || c.x > view.width + margin || c.y < -margin || c.y > view.height + margin) {
      return false;
    }

    // Check if it's in the top-N brightest DSOs in viewport
    const visibleDSOs: DSO[] = [];
    for (const d of getDSOs()) {
      const dIsHighlighted = this.highlightedDSO === d.id;
      
      if (!dIsHighlighted) {
        if (!this.visibleDSOTypes.has(d.type)) continue;
        const cat = getDSOCatalog(d.id);
        if (cat && !this.visibleDSOCatalogs.has(cat)) continue;
        if (maxMag !== null && d.mag !== null && d.mag > maxMag) continue;
        if (d.mag === null && maxMag !== null) continue;
      }

      const dp = project(d.ra, d.dec);
      const dc = toCanvas(dp.x, dp.y, view);
      const dMajorArcmin = d.majAxis ?? 1;
      const drx = Math.max(2, angularSizeToCanvasPx(dMajorArcmin / 2, d.dec, view.scale));
      const dMargin = drx + 20;
      if (dc.x < -dMargin || dc.x > view.width + dMargin || dc.y < -dMargin || dc.y > view.height + dMargin) {
        continue;
      }
      visibleDSOs.push(d);
    }

    if (visibleDSOs.length <= this.maxDSOCount) {
      return true; // No filtering needed
    }

    // Check if this DSO is in top-N brightest
    const topDSOs = visibleDSOs
      .sort((a, b) => {
        if (a.id === this.highlightedDSO) return -1;
        if (b.id === this.highlightedDSO) return 1;
        const magA = a.mag ?? 999;
        const magB = b.mag ?? 999;
        return magA - magB;
      })
      .slice(0, this.maxDSOCount);
    return topDSOs.includes(dso);
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

  render() {
    const { ctx, view } = this;
    const { width, height } = view;

    ctx.save();
    ctx.clearRect(0, 0, width, height);

    this.renderBackground();

    // ── Hemisphere clip circle ──────────────────────────────────────────────
    // borderLatDeg determines how far into the opposite hemisphere we show.
    // The cutoff declination is −borderLatDeg (North) or +borderLatDeg (South).
    // Its projection radius: r = tan((90 + borderLatDeg) / 2) (same formula for both).
    const poleOrigin = toCanvas(0, 0, view);
    const borderR = Math.tan((90 + this.borderLatDeg) / 2 * DEG2RAD) * view.scale;

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
      this.renderGrid();
    }
    if (this.showPhotoOutlines && this.photoOutlines.length > 0) {
      this.renderPhotoOutlines();
    }
    if (this.fovFrameSpecs.length > 0) {
      this.renderFovFrames();
    }
    if (this.fovInstances.length > 0) {
      this.renderFovInstances();
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
    const { cx, cy } = this.frameAnchorCanvas(f);
    const decForSize = f.anchorKind === 'sky' ? (f.dec ?? 0) : unproject(this.view.centerX, this.view.centerY).dec;
    const halfW = angularSizeToCanvasPx(f.wDeg * 30, decForSize, this.view.scale);
    const halfH = angularSizeToCanvasPx(f.hDeg * 30, decForSize, this.view.scale);
    const rotDeg = this.frameCanvasRotationDeg(f);
    const corners = computeFovFrameCorners(halfW, halfH, cx, cy, rotDeg);
    return { corners, cx, cy, rotDeg, halfW, halfH };
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

    for (const f of this.fovInstances) {
      if (f.visible === false) continue; // hidden via the manager checkbox
      const { corners, cx, cy, rotDeg, halfW, halfH } = this.frameGeometry(f);
      const isActive = f.active;

      ctx.save();
      ctx.globalAlpha = isActive ? 1 : 0.5;
      ctx.strokeStyle = isActive ? activeColor : strokeColor;
      ctx.lineWidth = isActive ? 2 : 1.5;
      ctx.setLineDash([8, 4]);
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
      ctx.closePath();
      ctx.stroke();

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
      }
      ctx.restore();
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
    }

    // Select another frame by clicking anywhere inside it (topmost first).
    for (let i = this.fovInstances.length - 1; i >= 0; i--) {
      const f = this.fovInstances[i];
      if (f.active || f.visible === false) continue;
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
        let ra: number, dec: number, dsoId: string | null = null;
        // Snap the centre to the nearest DSO when the anchor is on (both free
        // and plan frames); otherwise the centre follows the cursor exactly.
        const near = f.anchorSnap !== false ? this.findClosestDSO(mx, my) : null;
        if (near) {
          // Anchored: the snapped object sits at the centre, so it is the target.
          ra = near.ra; dec = near.dec; dsoId = near.id;
        } else {
          const proj = fromCanvas(mx, my, this.view);
          const u = unproject(proj.x, proj.y);
          ra = u.ra; dec = u.dec;
        }
        // Recompute the PA so the frame keeps the same on-screen angle at the
        // new position.
        const paDeg = this.canvasRotDegToPa(canvasRotDeg, ra);
        // A plan frame placed freely (anchor off) takes the DSO nearest its
        // centre that falls inside it (custom location if none).
        if (f.derivesTargetFromContent && !near) {
          const moved: RenderableFrame = { ...f, ra, dec, paDeg };
          dsoId = frameTargetDso(this.dsosInFrame(moved).map(d => d.id));
        }
        this.onFovInstanceChange?.(f.id, { anchor: { kind: 'sky', ra, dec, dsoId }, paDeg });
      } else {
        this.onFovInstanceChange?.(f.id, { anchor: { kind: 'screen', nx: mx / this.view.width, ny: my / this.view.height } });
      }
    }
  }

  private renderBackground() {
    const { ctx, view } = this;
    const cx = view.width / 2;
    const cy = view.height / 2;
    const maxR = Math.sqrt(view.width * view.width + view.height * view.height);

    // Solid black base (always opaque — ensures pitch-black at opacity 0)
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, view.width, view.height);

    if (this.backgroundOpacity <= 0) return;

    // Gradient overlay — color tokens are theme-specific, read at render time
    const style = getComputedStyle(document.documentElement);
    const inner = style.getPropertyValue('--sky-bg-inner').trim() || '#150d06';
    const outer = style.getPropertyValue('--sky-bg-outer').trim() || '#000000';

    ctx.save();
    ctx.globalAlpha = this.backgroundOpacity;
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
    gradient.addColorStop(0, inner);
    gradient.addColorStop(1, outer);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, view.width, view.height);
    ctx.restore();
  }

  private renderGrid() {
    const { ctx, view } = this;
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
      ctx.strokeStyle = dec === 0
        ? 'rgba(120, 210, 140, 0.9)'
        : 'rgba(100, 190, 120, 0.55)';
      ctx.lineWidth = dec === 0 ? 1.5 : 0.8;
      ctx.stroke();

      // Dec label (avoid labelling the pole and the boundary)
      const label = `${dec}°`;
      const absR = r;
      if (absR > 2 && Math.abs(dec) < 89) {
        // Position label at the bottom of the circle (y = origin.y + r)
        const lx = origin.x + 4;
        const ly = origin.y + r - 2;
        ctx.fillStyle = 'rgba(140, 220, 160, 1.0)';
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
      ctx.strokeStyle = 'rgba(100, 190, 120, 0.55)';
      ctx.lineWidth = 0.8;
      ctx.stroke();

      // RA label near the equator
      // Equator is at r=1 in projection units, but use a slightly inner position
      const labelProj = toCanvas(0.85 * Math.sin(raRad), 0.85 * Math.cos(raRad), view);
      const lx = labelProj.x;
      const ly = labelProj.y;
      ctx.fillStyle = 'rgba(140, 220, 160, 1.0)';
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

    const lineColor = getComputedStyle(document.documentElement)
      .getPropertyValue('--constellation-line').trim() || 'rgba(210, 195, 178, 0.55)';
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 1;

    for (const constellation of lines) {
      for (const segment of constellation.segments) {
        if (segment.length < 2) continue;

        ctx.beginPath();
        const first = project(segment[0][0], segment[0][1]);
        const firstC = toCanvas(first.x, first.y, view);
        ctx.moveTo(firstC.x, firstC.y);

        for (let i = 1; i < segment.length; i++) {
          const p = project(segment[i][0], segment[i][1]);
          const c = toCanvas(p.x, p.y, view);
          ctx.lineTo(c.x, c.y);
        }

        ctx.stroke();
      }
    }
  }

  private renderStars() {
    const { ctx, view } = this;
    const stars = getStars();
    // If maxMagOverride is Infinity, it means no limit
    let maxMag: number | null;
    if (this.maxMagOverride === Infinity) {
      maxMag = null; // No magnitude limit
    } else if (this.maxMagOverride !== null) {
      maxMag = this.maxMagOverride; // Use explicit override
    } else {
      maxMag = computeMaxMag(view.scale); // Compute from scale
    }

    // First pass: collect visible stars within viewport and magnitude limit
    const visibleStars: Star[] = [];
    for (const star of stars) {
      // Always include highlighted star
      const isHighlighted = this.highlightedStar === star.hip;
      
      if (!isHighlighted) {
        // Skip magnitude check if maxMag is null (no limit)
        if (maxMag !== null && star.mag > maxMag) continue;
        // Dec pre-filter: skip objects clearly outside the border
        if (this.hemisphere === 'north' && star.dec < -(this.borderLatDeg + 2)) continue;
        if (this.hemisphere === 'south' && star.dec > +(this.borderLatDeg + 2)) continue;
      }

      const p = project(star.ra, star.dec);
      const c = toCanvas(p.x, p.y, view);

      // Skip if off-screen (with margin)
      if (c.x < -20 || c.x > view.width + 20 || c.y < -20 || c.y > view.height + 20) {
        continue;
      }

      visibleStars.push(star);
    }

    // If we have more visible stars than the limit, keep only the brightest ones
    let starsToRender = visibleStars;
    if (visibleStars.length > this.maxStarCount) {
      starsToRender = visibleStars
        .sort((a, b) => {
          // Always prioritize highlighted star
          if (a.hip === this.highlightedStar) return -1;
          if (b.hip === this.highlightedStar) return 1;
          return a.mag - b.mag;
        })
        .slice(0, this.maxStarCount);  // Take the brightest N stars
    }

    // Draw the selected stars
    for (const star of starsToRender) {
      const p = project(star.ra, star.dec);
      const c = toCanvas(p.x, p.y, view);

      const radius = starRadius(star.mag, view.scale);
      const [r, g, b] = bvToRgb(star.bv);

      // Glow for bright stars
      if (star.mag < 2) {
        const glowR = radius * 4;
        const gradient = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, glowR);
        gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.3)`);
        gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
        ctx.fillStyle = gradient;
        ctx.fillRect(c.x - glowR, c.y - glowR, glowR * 2, glowR * 2);
      }

      // Star dot
      ctx.beginPath();
      ctx.arc(c.x, c.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fill();

      // Highlight indicator for searched star
      if (star.hip === this.highlightedStar) {
        ctx.strokeStyle = 'rgba(192, 120, 48, 0.85)';
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(c.x, c.y, radius + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  private renderStarLabels() {
    const { ctx, view } = this;
    const stars = getStars();

    ctx.font = '10px sans-serif';
    ctx.fillStyle = 'rgba(195, 180, 160, 0.55)';
    ctx.textBaseline = 'middle';

    for (const star of stars) {
      if (star.mag > 3 || !star.name) continue;

      const p = project(star.ra, star.dec);
      const c = toCanvas(p.x, p.y, view);

      if (c.x < -50 || c.x > view.width + 50 || c.y < -50 || c.y > view.height + 50) {
        continue;
      }

      const r = starRadius(star.mag, view.scale);
      ctx.fillText(star.name, c.x + r + 3, c.y);
    }

    ctx.textBaseline = 'alphabetic';
  }

  private renderDSOs() {
    const { ctx, view } = this;
    const dsos = getDSOs();
    // Magnitude cutoff: slightly more generous than stars
    // If maxMagOverride is Infinity, it means no limit
    let maxMag: number | null;
    if (this.maxMagOverride === Infinity) {
      maxMag = null; // No magnitude limit
    } else if (this.maxMagOverride !== null) {
      maxMag = this.maxMagOverride; // Use explicit override
    } else {
      maxMag = 6 + Math.log2(view.scale / 200) * 1.5; // Compute from scale
    }

    // First pass: collect visible DSOs within viewport and magnitude limit
    const visibleDSOs: DSO[] = [];
    for (const dso of dsos) {
      // Always include highlighted DSO
      const isHighlighted = this.highlightedDSO === dso.id;
      
      if (!isHighlighted) {
        if (!this.visibleDSOTypes.has(dso.type)) continue;
        const cat = getDSOCatalog(dso.id);
        if (cat && !this.visibleDSOCatalogs.has(cat)) continue;
        if (maxMag !== null && dso.mag !== null && dso.mag > maxMag) continue;
        if (dso.mag === null && maxMag !== null) continue;
        // Dec pre-filter: skip objects clearly outside the border
        if (this.hemisphere === 'north' && dso.dec < -(this.borderLatDeg + 2)) continue;
        if (this.hemisphere === 'south' && dso.dec > +(this.borderLatDeg + 2)) continue;
      }

      const p = project(dso.ra, dso.dec);
      const c = toCanvas(p.x, p.y, view);

      const majorArcmin = dso.majAxis ?? 1;
      const rx = Math.max(2, angularSizeToCanvasPx(majorArcmin / 2, dso.dec, view.scale));
      const margin = rx + 20;

      // Skip if completely off-screen
      if (c.x < -margin || c.x > view.width + margin || c.y < -margin || c.y > view.height + margin) {
        continue;
      }

      visibleDSOs.push(dso);
    }

    // If we have more visible DSOs than the limit, keep only the brightest ones
    let dsosToRender = visibleDSOs;
    if (visibleDSOs.length > this.maxDSOCount) {
      dsosToRender = visibleDSOs
        .sort((a, b) => {
          // Always prioritize highlighted DSO
          if (a.id === this.highlightedDSO) return -1;
          if (b.id === this.highlightedDSO) return 1;
          // Sort by magnitude, treating null as infinity (always comes last)
          const magA = a.mag ?? 999;
          const magB = b.mag ?? 999;
          return magA - magB;
        })
        .slice(0, this.maxDSOCount);
    }

    // Render the selected DSOs
    for (const dso of dsosToRender) {
      const p = project(dso.ra, dso.dec);
      const c = toCanvas(p.x, p.y, view);

      const majorArcmin = dso.majAxis ?? 1;
      const minorArcmin = dso.minAxis ?? majorArcmin;
      const rx = Math.max(2, angularSizeToCanvasPx(majorArcmin / 2, dso.dec, view.scale));
      const ry = Math.max(2, angularSizeToCanvasPx(minorArcmin / 2, dso.dec, view.scale));
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
    const dsos = getDSOs();
    // Magnitude cutoff: slightly more generous than stars
    // Handle Infinity as no limit, just like in renderDSOs
    let maxMag: number | null;
    if (this.maxMagOverride === Infinity) {
      maxMag = null; // No magnitude limit
    } else if (this.maxMagOverride !== null) {
      maxMag = this.maxMagOverride; // Use explicit override
    } else {
      maxMag = 6 + Math.log2(view.scale / 200) * 1.5; // Compute from scale
    }

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

    // First pass: collect visible DSOs (same filtering as renderDSOs)
    const visibleDSOs: DSO[] = [];
    for (const dso of dsos) {
      const isHighlighted = this.highlightedDSO === dso.id;
      
      if (!isHighlighted) {
        if (!this.visibleDSOTypes.has(dso.type)) continue;
        const cat = getDSOCatalog(dso.id);
        if (cat && !this.visibleDSOCatalogs.has(cat)) continue;
        if (maxMag !== null && dso.mag !== null && dso.mag > maxMag) continue;
        if (dso.mag === null && maxMag !== null) continue;
      }

      const p = project(dso.ra, dso.dec);
      const c = toCanvas(p.x, p.y, view);

      // Basic viewport check (generous for labels that extend beyond circles)
      if (c.x < -80 || c.x > view.width + 80 || c.y < -20 || c.y > view.height + 20) {
        continue;
      }

      visibleDSOs.push(dso);
    }

    // If we have more visible DSOs than the limit, keep only the brightest ones
    let dsosToLabel = visibleDSOs;
    if (visibleDSOs.length > this.maxDSOCount) {
      dsosToLabel = visibleDSOs
        .sort((a, b) => {
          // Always prioritize highlighted DSO
          if (a.id === this.highlightedDSO) return -1;
          if (b.id === this.highlightedDSO) return 1;
          // Sort by magnitude, treating null as infinity (always comes last)
          const magA = a.mag ?? 999;
          const magB = b.mag ?? 999;
          return magA - magB;
        })
        .slice(0, this.maxDSOCount);
    }

    // Render labels for selected DSOs
    for (const dso of dsosToLabel) {
      const isMess = dso.id.startsWith('M') && !dso.id.startsWith('M0');
      const majorArcmin = dso.majAxis ?? 1;
      const rx = angularSizeToCanvasPx(majorArcmin / 2, dso.dec, view.scale);

      // Label visibility rules
      if (isMess && view.scale <= 100) continue;
      if (!isMess && (view.scale <= 300 || rx <= 4)) continue;

      const p = project(dso.ra, dso.dec);
      const c = toCanvas(p.x, p.y, view);

      const label = isMess ? dso.id
        : dso.id.startsWith('LPN-') ? (dso.displayName || dso.id.replace(/^LPN-/, ''))
        : dso.id.replace('NGC', 'NGC ').replace(/^IC(\d)/, 'IC $1')
               .replace('LBN', 'LBN ').replace('LDN', 'LDN ').replace('SH2-', 'Sh2-').replace('vdB', 'vdB ').replace(/^(Abell)(\d)/, '$1 $2');
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
