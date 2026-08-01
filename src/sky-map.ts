import type { Star, DSO, ViewState, Point, ConstellationStyle } from './types';
import type { HorizonProfile, HorizonSummit } from './horizon-io';
import {
  normalizeRotationDeg,
  type FovFrameSpec,
  type RenderableFrame,
  type FovFrameResizeRegion,
  type FovFrameChange,
  type HorizonParams,
  type AltAzPoint,
  type StarHoverCallback,
  type DSOHoverCallback,
  type SummitHoverCallback,
  type StarPickedCallback,
} from './sky-map-types';
import { t } from './i18n';
import {
  project,
  projectCached,
  toCanvas,
  fromCanvas,
  unproject,
  setHemisphere,
  fitScaleForBorderCircle,
  borderRadiusPU,
  bumpObsGeneration,
  isBelowHorizonCached,
  setCenterMode,
  setProjectionObserver,
} from './projection';
import {
  dateToJD,
  lstHours,
  moonRaDecDeg,
  moonPhase,
  sunRaDecDeg,
  planetRaDecDeg,
  PLANET_KEYS,
  type PlanetKey,
} from './astro-time';
import { altAzFromRaDec, raDecFromAltAz } from './sky-geometry';
import { drawMoonMarker } from './moon-draw';
import { drawBodyMarker, drawBodyLabel } from './body-draw';
import { getStars, getStarMagsSorted, loadConstellationStyle } from './star-catalog';
import { getDSOs } from './dso-catalog';
import { targetRenderCount, DSO_DENSITY_K, MIN_BUDGET_MULT } from './render-budget';
import {
  starAreaBudget,
  starFaintLimitAt,
  starMagThreshold,
  type StarAreaBudget,
} from './star-budget';
import { SKY_THEME } from './sky-themes';
import { computeMaxMag, starRadius, atlasScaleBucket, computeStarPaint } from './star-render-math';
import { paintStar, buildStarSprite } from './star-draw';
import { angularSizeToCanvasPx, dsoSizeCos2, dsoCanvasAngle } from './dso-render-math';
import { InteractionLod } from './interaction-lod';
import {
  pointInConvexPolygon,
  photoLabelEdgeIndex,
  photoLabelTransform,
  findTopPhotoOutlineAtPoint,
  type PhotoOutline,
} from './photo-outline';
import { computeFovFrameCorners } from './frame-geometry';
import { canvasPxPerDeg, isSkyPointVisible } from './sky-axes';
import { easeInOutCubic, navigateDurationMs, navigateProfile } from './sky-view-math';
import { resolveHover } from './hover-resolve';
import { RegionDrawGesture } from './sky-region-draw';
import { FrameController } from './frame-controller';
import { attachSkyMapEvents, type EventBinding, type SkyEventHost } from './sky-map-events';
import { SkyHitTest, isStarRendered, type DsoIndexFilters } from './sky-hit-test';
import { DsoRenderSelection } from './dso-render-select';
import {
  drawBackground,
  drawFisheyeGrid,
  drawGrid,
  drawGridZenith,
  drawConstellationLines,
  drawConstellationNames,
  drawHorizonLine,
  drawMountainHorizon,
  drawSummitDots,
  drawCardinalPoints,
  drawAzimuthGrid,
  drawTileTrash,
  drawTileAdd,
} from './sky-draw';
import {
  FONTS,
  FRAME,
  BORDER_RING,
  HIGHLIGHT_RING,
  PHOTO_OUTLINE,
  DSO_LABEL_COLORS,
  DEFAULT_DSO_LABEL_COLOR,
} from './canvas-theme';
import { drawDsoMarker, drawDsoHighlightRing } from './dso-draw';
import { formatDsoLabel, dsoLabelVisible } from './dso-label';
import {
  drawFramePolyline,
  drawEdgeLabel,
  drawFrameHandles,
  drawResizeDraftRect,
  drawElasticSnapLine,
} from './frame-draw';

const DEG2RAD = Math.PI / 180;

// Photo-outline geometry now lives in ./photo-outline; re-exported here for the
// existing import sites (tests, export-render, overlays) that reference sky-map.
export {
  pointInConvexPolygon,
  photoLabelEdgeIndex,
  photoLabelTransform,
  findTopPhotoOutlineAtPoint,
};
export type { PhotoOutline };

// Frame/callback shapes and normalizeRotationDeg now live in ./sky-map-types, so
// modules that only need the types (frame geometry, stores, overlays, tests) don't
// pull in this canvas class. Re-exported here for the existing import sites.
export type {
  FovFrameSpec,
  RenderableFrame,
  FovFrameResizeRegion,
  FovFrameChange,
  HorizonParams,
  AltAzPoint,
  StarHoverCallback,
  DSOHoverCallback,
  SummitHoverCallback,
  StarPickedCallback,
};
export { normalizeRotationDeg };

// Frame canvas geometry now lives in ./frame-geometry (imported above);
// computeFovFrameCorners is re-exported here for existing import sites (export-render, tests).
export { computeFovFrameCorners };

// Star size/colour/glow maths live in ./star-render-math; the canvas star draw
// (paintStar) and sprite baking (buildStarSprite) live in ./star-draw.

// DSO angular-size / orientation maths now live in ./dso-render-math (imported above).

export class SkyMap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private view: ViewState;
  private onViewChange: (() => void) | null = null;
  private onStarHover: StarHoverCallback | null = null;
  private onDSOHover: DSOHoverCallback | null = null;
  private onSummitHover: SummitHoverCallback | null = null;
  private showDSOs = true;
  private showStars = true;
  private showConstellationLines = true;
  private showConstellationNames = true;
  private constellationStyle: ConstellationStyle = 'western';
  private visibleDSOTypes: Set<string> = new Set([
    'GxS',
    'GxE',
    'GxI',
    'Gx',
    'OC',
    'GC',
    'EN',
    'RN',
    'PN',
    'SNR',
    'DN',
    '?',
  ]);
  private visibleDSOCatalogs: Set<string> = new Set(['M', 'NGC', 'IC', 'SH2']);
  private showGrid = true;
  private showStarLabels = true;
  private showDSOLabels = true;
  private skyOpacity = 0.5;
  private backgroundOpacity = 1.0;
  // The app's single sky theme (background, stars, glow, grid tint).
  private readonly skyTheme = SKY_THEME;

  // ── Date mode: Moon overlay + horizon simulation ────────────────────────────
  private showMoon = false;
  private showSun = false;
  private showPlanets = false;
  private showAzimuthGrid = false;
  // Observer's terrain skyline (mountain horizon) + whether to draw it. Only
  // rendered in date mode with an observer location set (same gate as the horizon).
  private mountainProfile: HorizonProfile | null = null;
  private showMountainHorizon = false;
  // Red N/E/S/W labels at the horizon, to orient the local-sky view.
  private showCardinalPoints = false;
  private skyTimeMode: 'live' | 'date' = 'live';
  private simDate: Date = new Date();
  private obsLat: number | null = null;
  private obsLon: number | null = null;
  // Below-horizon objects are dimmed (not hidden) to this alpha, in date mode only.
  private static readonly BELOW_HORIZON_ALPHA = 0.18;

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
  // Anchor of the currently-shown hover tooltip: the canvas coords and simDate at the
  // moment it was last shown for an object. Used to keep the tooltip alive while the
  // clock is advancing (date mode): the sky rotates and the object drifts out from
  // under a stationary cursor, so the next mousemove/jitter hit-tests empty sky and
  // would dismiss it. We only dismiss on real cursor movement, not object drift — see
  // handleHover(). null when no tooltip is shown.
  private hoverAnchor: { mx: number; my: number; simMs: number } | null = null;
  // A stationary-cursor jitter is a move under this many canvas px from the anchor.
  private static readonly HOVER_DRIFT_GRACE_PX = 6;
  private maxStarCount = 2000;
  private maxDSOCount = 500;
  // Which DSOs to draw this frame — single source of truth shared by renderDSOs,
  // renderDSOLabels and isDSORendered so drawing and hit-testing agree. Owns the
  // all-DSO position index and the per-frame cache (invalidated at the top of
  // render(), rebuilt lazily e.g. on a hover between frames). See ./dso-render-select.
  private dsoSelection = new DsoRenderSelection();
  private highlightedDSO: string | null = null; // ID of DSO to always render
  private highlightedStar: number | null = null; // HIP number of star to highlight
  private photoOutlines: PhotoOutline[] = [];
  private showPhotoOutlines = true;
  private fovFrameSpecs: FovFrameSpec[] = [];
  private fovRotationDeg = 0;

  // Interactive frame instances and the whole drag/pin/snap/merge/resize state
  // machine. See ./frame-controller (unit-tested against a stub host). Built in the
  // constructor because its host reads live state off this instance.
  private frames: FrameController;

  // Freehand sky-region drawing (Local Sky / zenith view only, see enterRegionDrawMode).
  // The gesture's state machine lives in ./sky-region-draw (unit-tested).
  private regionDraw = new RegionDrawGesture();
  // A saved region shown on the map for reference (see setActiveRegionOverlay); only
  // meaningful while localSkyMode is active, since the polygon is stored in Alt/Az.
  private activeRegionOverlay: {
    color: string;
    points: AltAzPoint[];
  } | null = null;

  // Cursor hit-testing (star/DSO spatial indexes + summit search). See ./sky-hit-test.
  private hitTest = new SkyHitTest();

  // Animation
  private animationId: number | null = null;

  // Coalesced-render frame handle (separate from animationId so navigation/snap
  // animations and render coalescing never clobber each other's rAF handle).
  private _renderRaf: number | null = null;

  // ── Interaction LOD & auto density ──────────────────────────────────────────
  // All adaptive-budget state and decisions live in InteractionLod (unit-tested).
  // SkyMap keeps only the concrete budgets (maxStarCount/maxDSOCount), the settle
  // timer, and the render/callback side effects.
  private lod = new InteractionLod();
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private onAutoDensityChange: ((dso: number) => void) | null = null;
  // During a gesture the frozen star sprite atlas is rebuilt once the live zoom drifts
  // past this radius ratio from it — bounding how much drawImage upscales (and thus
  // pixelates) a frozen sprite, while a continuous zoom rebuilds only once per such
  // step rather than every frame (see renderStars).
  private static readonly ATLAS_REBUILD_RATIO = 1.3;

  // Listeners registered by attachSkyMapEvents, removed on destroy().
  private eventBindings: EventBinding[] = [];

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

  // Local sky (zenith-centered) mode — date mode + observer location only
  private localSkyMode = false;

  // Overlay canvas — sits above the photo layer in the DOM, used to draw frames on top of photos
  private overlayCanvas: HTMLCanvasElement | null = null;
  private overlayCtx: CanvasRenderingContext2D | null = null;
  // True while renderToCanvas() is active — causes render() to draw frames inline rather than on the overlay
  private _renderingOffscreen = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.view = { centerX: 0, centerY: 0, scale: 0, rotationDeg: 0, width: 0, height: 0 };
    const map = this;
    this.frames = new FrameController({
      // Getters, not a snapshot: the controller must always see the live view and
      // interaction flags, which change under it between frames.
      get view() {
        return map.view;
      },
      get interactionEnabled() {
        return map.interactionEnabled;
      },
      get pickingMode() {
        return map.pickingMode;
      },
      findClosestDSO: (mx, my) => map.findClosestDSO(mx, my),
      dsosInFrame: (f) => map.dsosInFrame(f),
      requestRenderInteractive: () => map.requestRenderInteractive(),
      render: () => map.render(),
      navigateTo: (ra, dec, scale, animate) => map.navigateTo(ra, dec, scale, animate),
    });
    this.eventBindings = attachSkyMapEvents(this.eventHost());
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

  setOnSummitHover(cb: SummitHoverCallback) {
    this.onSummitHover = cb;
  }

  setShowDSOs(show: boolean) {
    this.showDSOs = show;
    this.requestRender();
  }

  setShowStars(show: boolean) {
    this.showStars = show;
    this.requestRender();
  }
  setShowConstellationLines(show: boolean) {
    this.showConstellationLines = show;
    this.requestRender();
  }
  setShowConstellationNames(show: boolean) {
    this.showConstellationNames = show;
    this.requestRender();
  }

  /** Independent of live/date mode — shows the Moon's real position in live mode. */
  setShowMoon(show: boolean) {
    this.showMoon = show;
    this.requestRender();
  }

  /** Only rendered in date mode, same gating as the Moon toggle. */
  setShowSun(show: boolean) {
    this.showSun = show;
    this.requestRender();
  }

  /** Only rendered in date mode; shows all 7 planets (Mercury–Neptune) together. */
  setShowPlanets(show: boolean) {
    this.showPlanets = show;
    this.requestRender();
  }

  /** The alt-az grid — only drawn in date mode once an observer location is set. */
  setShowAzimuthGrid(show: boolean) {
    this.showAzimuthGrid = show;
    this.requestRender();
  }

  /** The observer's terrain skyline profile (mountain horizon); null clears it. */
  setMountainHorizon(profile: HorizonProfile | null) {
    this.mountainProfile = profile;
    this.requestRender();
  }

  /** Whether to draw the mountain horizon — only visible in date mode with a location. */
  setShowMountainHorizon(show: boolean) {
    this.showMountainHorizon = show;
    this.requestRender();
  }

  /** Red cardinal-point (N/E/S/W) labels — only visible in date mode with a location. */
  setShowCardinalPoints(show: boolean) {
    this.showCardinalPoints = show;
    this.requestRender();
  }

  /** Switches between today's always-full-sky view and the date-driven horizon simulation. */
  setSkyTimeMode(mode: 'live' | 'date') {
    if (mode !== 'date' && this.localSkyMode) this.setLocalSkyMode(false);
    this.skyTimeMode = mode;
    bumpObsGeneration();
    this.requestRender();
  }

  /** The simulated instant used for horizon visibility and the Moon while in date mode. */
  setSimDate(date: Date) {
    this.simDate = date;
    bumpObsGeneration();
    this.refreshLocalSkyObserver();
    this.requestRender();
  }

  /** Observer lat/lon for horizon visibility; null disables horizon masking/line. */
  setObserverLocation(lat: number | null, lon: number | null) {
    this.obsLat = lat;
    this.obsLon = lon;
    bumpObsGeneration();
    if ((lat === null || lon === null) && this.localSkyMode) {
      this.setLocalSkyMode(false);
    } else {
      this.refreshLocalSkyObserver();
    }
    this.requestRender();
  }

  /**
   * Switch to/from the zenith-centered "local sky" (horizon-to-horizon dome) view —
   * altitude 90° (zenith) at the origin, azimuth grid drawn as concentric rings.
   * Requires date mode + an observer location already set; no-ops (stays disabled)
   * if computeHorizonParams() can't resolve, so projection.ts's observer state is
   * never left stale/meaningless.
   */
  setLocalSkyMode(v: boolean): void {
    if (v) {
      const h = this.computeHorizonParams();
      if (!h) return;
      this.localSkyMode = true;
      setCenterMode('zenith');
      setProjectionObserver(h.lstH, h.latDeg);
    } else {
      this.localSkyMode = false;
      setCenterMode('pole');
    }
    this.invalidateSpatialIndexes();
    this.cancelAnimation();
    this.view.centerX = 0;
    this.view.centerY = 0;
    this.view.rotationDeg = 0;
    if (this.view.width > 0) {
      this.view.scale = (Math.min(this.view.width, this.view.height) / 2) * 0.9;
    }
    this.onViewChange?.();
    this.requestRender();
  }

  getLocalSkyMode(): boolean {
    return this.localSkyMode;
  }

  /**
   * Re-syncs projection.ts's zenith observer state + hit-test indexes + photo
   * overlay after a simulated-date/location change, but only while local-sky mode
   * is active — pole-centered modes never pay this per-tick cost. Hit-test indexes
   * (buildStarIndex/buildDSOIndex) are keyed only on maxMag, not on projection
   * generation, so they need an explicit invalidation here or hover/click would
   * silently target stale screen positions as simulated time advances.
   */
  private refreshLocalSkyObserver(): void {
    if (!this.localSkyMode) return;
    const h = this.computeHorizonParams();
    if (!h) return;
    setProjectionObserver(h.lstH, h.latDeg);
    this.invalidateSpatialIndexes();
    this.onViewChange?.();
  }

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
  setMaxStarCount(count: number) {
    this.maxStarCount = count;
    this.requestRenderInteractive();
  }
  setMaxDSOCount(count: number) {
    this.maxDSOCount = count;
    this.requestRenderInteractive();
  }
  /** Fix the star budget (constellations + bright stars) and stop motion-throttling it. */
  setAutoStarDensity(v: boolean) {
    this.lod.autoStarDensity = v;
    if (v) this.requestRender();
  }
  /** Enable/disable performance-driven real-time auto-tuning of the DSO density budget.
   * Enabling kicks off a one-shot calibration so the slider snaps to the right value now. */
  setAutoDSODensity(v: boolean) {
    this.lod.autoDSODensity = v;
    if (v) this.lod.dsoCalibrating = true;
    this.requestRender();
  }
  /** Notified with the new DSO budget whenever auto-tuning changes it, so the UI can track it. */
  setOnAutoDensityChange(cb: (dso: number) => void) {
    this.onAutoDensityChange = cb;
  }
  /** Enable/disable the motion LOD (detail reduction while panning/zooming). */
  setMotionLOD(v: boolean) {
    this.lod.motionLOD = v;
    this.requestRender();
  }
  setHighlightedDSO(dsoId: string | null) {
    this.highlightedDSO = dsoId;
    this.hitTest.invalidateDsoIndex();
    this.requestRender();
  }
  setHighlightedStar(hip: number | null) {
    this.highlightedStar = hip;
    this.hitTest.invalidateStarIndex();
    this.requestRender();
  }
  setVisibleDSOTypes(types: Set<string>) {
    this.visibleDSOTypes = types;
    this.hitTest.invalidateDsoIndex();
    this.requestRender();
  }
  setVisibleDSOCatalogs(catalogs: Set<string>) {
    this.visibleDSOCatalogs = catalogs;
    this.hitTest.invalidateDsoIndex();
    this.requestRender();
  }
  setShowGrid(show: boolean) {
    this.showGrid = show;
    this.requestRender();
  }
  setShowStarLabels(show: boolean) {
    this.showStarLabels = show;
    this.requestRender();
  }
  setShowDSOLabels(show: boolean) {
    this.showDSOLabels = show;
    this.requestRender();
  }
  setSkyOpacity(v: number) {
    this.skyOpacity = v;
    this.requestRender();
  }
  setBackgroundOpacity(v: number) {
    this.backgroundOpacity = v;
    this.requestRender();
  }
  setPhotoOutlines(outlines: PhotoOutline[]) {
    this.photoOutlines = outlines;
  }
  setShowPhotoOutlines(show: boolean) {
    this.showPhotoOutlines = show;
    this.requestRender();
  }
  setFovFrames(frames: FovFrameSpec[]) {
    this.fovFrameSpecs = frames;
    this.requestRender();
  }
  setFovRotationDeg(deg: number) {
    this.fovRotationDeg = deg;
    this.requestRender();
  }

  // ── Interactive frames ────────────────────────────────────────────────────
  // Thin delegations onto FrameController, which owns all the frame state.

  /** Replace the interactive frame instances and re-render. */
  setFovInstances(frames: RenderableFrame[]) {
    this.frames.setFrames(frames);
    this.requestRender();
  }
  /** Current interactive frame instances (for save/restore around off-screen renders). */
  getFovInstances(): RenderableFrame[] {
    return this.frames.frames;
  }
  setOnFovInstanceSelect(cb: (id: string | null) => void) {
    this.frames.setOnSelect(cb);
  }
  setOnFovInstanceChange(cb: (id: string, change: FovFrameChange) => void) {
    this.frames.setOnChange(cb);
  }
  setOnFovFrameResize(cb: (id: string, region: FovFrameResizeRegion) => void) {
    this.frames.setOnResize(cb);
  }
  setOnMosaicTileRemove(cb: (tileId: string) => void) {
    this.frames.setOnTileRemove(cb);
  }
  setOnMosaicTileAdd(cb: (ra: number, dec: number) => void) {
    this.frames.setOnTileAdd(cb);
  }
  setMosaicAddCandidates(c: Array<{ ra: number; dec: number }>) {
    this.frames.setMosaicAddCandidates(c);
    this.requestRender();
  }
  setOnFrameMerge(cb: (movedId: string, targetId: string) => void) {
    this.frames.setOnMerge(cb);
  }

  /** Toggle the pin state of a frame by id (used by the frame-manager popup). */
  toggleFramePinById(id: string): void {
    this.frames.toggleFramePinById(id);
  }
  /** Pin the currently-active frame if it is still floating. */
  pinActiveIfFloating(): void {
    this.frames.pinActiveIfFloating();
  }
  /** Change the active frame, auto-pinning the previously-active floating one. */
  selectFrame(id: string | null): void {
    this.frames.selectFrame(id);
  }
  /** Pin every floating frame to its exact current sky position (no DSO snap). */
  pinAllFloatingFrames(): void {
    this.frames.pinAllFloatingFrames();
  }
  /** Re-run anchor detection on a pinned frame and snap it to the nearest DSO. */
  resnapFrame(id: string): void {
    this.frames.resnapFrame(id);
  }
  /** Bring the given frame to the centre of the view. */
  centerFrameInView(id: string): void {
    this.frames.centerFrameInView(id);
  }

  /** Sky coordinates (degrees) at the centre of the current viewport — used to
   * spawn a new frame on the visible sky. */
  viewCenterSky(): { ra: number; dec: number } {
    const proj = fromCanvas(this.view.width / 2, this.view.height / 2, this.view);
    return unproject(proj.x, proj.y);
  }
  setOnPhotoClick(cb: (photoName: string) => void) {
    this.onPhotoClick = cb;
  }
  setOnDSOClick(cb: (dso: DSO) => void) {
    this.onDSOClick = cb;
  }
  setOnClearSelection(cb: () => void) {
    this.onClearSelection = cb;
  }

  /** The currently selected/highlighted DSO id on the map, or null. */
  getHighlightedDSOId(): string | null {
    return this.highlightedDSO;
  }
  /** Arm a one-shot picker: the next DSO the user clicks is passed to `cb` (in
   * addition to the normal selection action). Used to choose a mosaic target. */
  armDSOPick(cb: (dso: DSO) => void) {
    this.onNextDSOPick = cb;
  }
  /** Cancel a pending one-shot DSO pick (e.g. the user dismissed the prompt). */
  cancelDSOPick() {
    this.onNextDSOPick = null;
  }

  /** Switch hemisphere, reset view to pole origin at fit-equator scale, and redraw. */
  setHemisphere(h: 'north' | 'south', borderLatDeg?: number) {
    this.hemisphere = h;
    if (borderLatDeg !== undefined) this.borderLatDeg = borderLatDeg;
    setHemisphere(h);
    // Reset spatial indexes (projection coords change)
    this.hitTest.invalidate();
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
    this.hitTest.invalidate();
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
      this.view.scale = (Math.min(this.view.width, this.view.height) / 2) * 0.9;
    }
    this.onViewChange?.();
    this.requestRender();
  }

  /** Invalidate spatial indexes so they are rebuilt on the next render. */
  invalidateSpatialIndexes() {
    this.hitTest.invalidate();
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

  getShowGrid() {
    return this.showGrid;
  }

  /**
   * Budget context for the area-weighted star gate at the current view. The maths
   * lives in ./star-budget (pure, unit-tested); this binds the live view, border
   * latitude and the LOD-reduced density budget.
   */
  private starAreaBudget(): StarAreaBudget {
    return starAreaBudget(
      this.view,
      this.borderLatDeg,
      this.lod.effectiveStarBudget(this.maxStarCount),
      getStarMagsSorted(),
    );
  }

  /** Position-independent star magnitude limit for the current view. */
  private starMagThreshold(): number {
    return starMagThreshold(this.starAreaBudget());
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
    const budget = this.lod.effectiveDSOBudget(this.maxDSOCount);
    return targetRenderCount(
      budget,
      scale,
      width,
      height,
      DSO_DENSITY_K,
      budget * MIN_BUDGET_MULT,
      getDSOs().length,
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

    // Adaptive duration based on distance and zoom ratio.
    const { normalizedDist, zoomRatio } = navigateProfile(
      this.view,
      target.x,
      target.y,
      targetScale,
    );
    const duration = navigateDurationMs(normalizedDist, zoomRatio);

    const step = (now: number) => {
      let t = (now - startTime) / duration;
      if (t >= 1) {
        t = 1;
        this.animationId = null;
      }

      const ease = easeInOutCubic(t);

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
        if (this.settleTimer !== null) {
          clearTimeout(this.settleTimer);
          this.settleTimer = null;
        }
        this.lod.endInteraction();
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
  getFovRotationDeg(): number {
    return this.fovRotationDeg;
  }

  /** Current FOV frame specs (for save/restore around off-screen renders). */
  getFovFrames(): FovFrameSpec[] {
    return this.fovFrameSpecs;
  }

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

  /**
   * Starts a freehand sky-region drawing gesture: forces Local Sky (zenith) mode on
   * (restored to its prior state once the gesture ends) so captured points are in
   * Alt/Az, a time-invariant frame matching "what I can see from a fixed location".
   * Returns false (no-op) if no observer location is set — same guard as
   * setLocalSkyMode, since computeHorizonParams() can't resolve without one.
   */
  enterRegionDrawMode(onComplete: (points: AltAzPoint[]) => void, onCancel: () => void): boolean {
    if (!this.computeHorizonParams()) return false;
    this.regionDraw.enter({ onComplete, onCancel }, this.localSkyMode);
    if (!this.localSkyMode) this.setLocalSkyMode(true);
    this.canvas.style.cursor = 'crosshair';
    this.dismissTooltip();
    return true;
  }

  /** Cancels an in-progress region drawing gesture (e.g. a "Cancel" button). */
  cancelRegionDrawMode(): void {
    if (this.regionDraw.active) this.finishRegionDraw(true);
  }

  private finishRegionDraw(cancelled: boolean): void {
    const { restoreLocalSkyOff } = this.regionDraw.finish(cancelled);
    this.canvas.style.cursor = 'default';
    if (restoreLocalSkyOff) this.setLocalSkyMode(false);
    this.requestRender();
  }

  /** Canvas point → Alt/Az, or null when no observer location is set. */
  private canvasToAltAz(mx: number, my: number): AltAzPoint | null {
    const hp = this.computeHorizonParams();
    if (!hp) return null;
    const proj = fromCanvas(mx, my, this.view);
    const { ra, dec } = unproject(proj.x, proj.y);
    const { altDeg, azDeg } = altAzFromRaDec(ra, dec, hp.lstH, hp.latDeg);
    return { azDeg, altDeg };
  }

  /** Shows a saved region on the map for reference; pass null to clear it. Requires
   * Local Sky mode to render meaningfully (the polygon is stored in Alt/Az). */
  setActiveRegionOverlay(region: { color: string; points: AltAzPoint[] } | null): void {
    this.activeRegionOverlay = region;
    this.requestRender();
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

  /** Display state the hover DSO index filters on. */
  private dsoIndexFilters(): DsoIndexFilters {
    return {
      visibleTypes: this.visibleDSOTypes,
      visibleCatalogs: this.visibleDSOCatalogs,
      highlightedId: this.highlightedDSO,
    };
  }

  private findClosestStar(mx: number, my: number): Star | null {
    // Match the renderer's magnitude gate so the hover index is a superset of what is
    // drawn (isStarRendered does the final confirm).
    return this.hitTest.findClosestStar(mx, my, this.view, this.starMagThreshold());
  }

  /**
   * Adapter handed to ./sky-map-events, which owns the pointer/keyboard routing.
   * Live values are exposed as getters so the handlers always see current state.
   */
  private eventHost(): SkyEventHost {
    const map = this;
    return {
      get canvas() {
        return map.canvas;
      },
      get view() {
        return map.view;
      },
      get borderLatDeg() {
        return map.borderLatDeg;
      },
      get interactionEnabled() {
        return map.interactionEnabled;
      },
      get pickingMode() {
        return map.pickingMode;
      },
      get photoOutlines() {
        return map.photoOutlines;
      },
      get hoveredDSO() {
        return map.hoveredDSO;
      },
      hasSelection: () => map.highlightedDSO !== null || map.highlightedStar !== null,

      regionDrawActive: () => map.regionDraw.active,
      regionDrawCapturing: () => map.regionDraw.capturing,
      regionDrawPress: () => map.regionDraw.press(),
      regionDrawMove: (pt) => map.regionDraw.move(pt),
      regionDrawFinish: (cancelled) => map.finishRegionDraw(cancelled),
      canvasToAltAz: (mx, my) => map.canvasToAltAz(mx, my),

      frameMouseDown: (mx, my) => map.frames.handleMouseDown(mx, my),
      frameDragActive: () => map.frames.activeDrag !== null,
      frameDragMove: (mx, my) => map.frames.handleDragMove(mx, my),
      frameMouseUp: () => map.frames.handleMouseUp(),
      frameHasActive: () => map.frames.hasActiveFrame(),
      frameClearInteraction: () => map.frames.clearInteraction(),
      frameSelect: (id) => map.frames.selectFrame(id),

      cancelAnimation: () => map.cancelAnimation(),
      dismissTooltip: () => map.dismissTooltip(),
      requestHover: (mx, my, cx, cy) => map.requestHover(mx, my, cx, cy),
      requestRenderInteractive: () => map.requestRenderInteractive(),
      render: () => map.render(),
      viewChanged: () => map.onViewChange?.(),
      findClosestStar: (mx, my) => map.findClosestStar(mx, my),
      exitPickingMode: () => map.exitPickingMode(),

      hasStarPickedHandler: () => map.onStarPicked !== null,
      hasPhotoClickHandler: () => map.onPhotoClick !== null,
      emitStarPicked: (star) => map.onStarPicked?.(star),
      emitPhotoClick: (name) => map.onPhotoClick?.(name),
      emitDSOClick: () => {
        const dso = map.hoveredDSO;
        if (!dso) return;
        map.onDSOClick?.(dso);
        // A one-shot picker (e.g. choosing a mosaic target) fires after the
        // normal selection so the click still selects the DSO as usual.
        if (map.onNextDSOPick) {
          const cb = map.onNextDSOPick;
          map.onNextDSOPick = null;
          cb(dso);
        }
      },
      emitClearSelection: () => map.onClearSelection?.(),
    };
  }

  destroy() {
    this.cancelAnimation();
    this.frames.cancelSnapAnim();
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
    for (const { target, event, handler } of this.eventBindings) {
      target.removeEventListener(event, handler);
    }
    this.eventBindings = [];
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
    this.hoverAnchor = null;
    this.onStarHover?.(null, 0, 0);
    this.onDSOHover?.(null, 0, 0);
  }

  private findClosestDSO(mx: number, my: number): DSO | null {
    if (!this.showDSOs) return null;
    return this.hitTest.findClosestDSO(mx, my, this.view, this.dsoIndexFilters());
  }

  /**
   * DSOs whose centre falls inside the given frame's polygon, sorted by distance
   * to the frame centre (nearest first). Used to derive a plan frame's target
   * after a move. Mag limit matches {@link findClosestDSO}.
   */
  private dsosInFrame(f: RenderableFrame): DSO[] {
    if (!this.showDSOs) return [];
    const maxMag = computeMaxMag(this.view.scale) + 4;
    return this.hitTest.dsosInFrame(
      this.frames.frameGeometry(f),
      this.view,
      maxMag,
      this.dsoIndexFilters(),
    );
  }

  /**
   * Check if a star would actually be rendered given current viewport and limits.
   * Replicates the filtering logic from renderStars().
   */
  private isStarRendered(star: Star): boolean {
    return isStarRendered(star, this.view, this.starAreaBudget(), this.highlightedStar);
  }

  /**
   * Check if a DSO would actually be rendered given current viewport and limits.
   * Replicates the filtering logic from renderDSOs().
   */
  private isDSORendered(dso: DSO): boolean {
    // Consult the same per-frame selection the renderer uses, so hover/click
    // gating exactly matches what is drawn (including the container-size gate).
    this.selectRenderedDSOs();
    return this.dsoSelection.has(dso.id);
  }

  /**
   * Schedule a hover hit-test for the next frame, coalescing bursts of mousemove
   * events into one test. Skipped entirely while actively panning/zooming: the
   * object under the cursor changes every frame and no tooltip is being read, so the
   * work is wasted until motion settles.
   */
  private requestHover(mx: number, my: number, clientX: number, clientY: number) {
    this.pendingHover = { mx, my, clientX, clientY };
    if (this.lod.interacting || this.hoverRaf !== null) return;
    this.hoverRaf = requestAnimationFrame(() => {
      this.hoverRaf = null;
      const h = this.pendingHover;
      this.pendingHover = null;
      if (h) this.handleHover(h.mx, h.my, h.clientX, h.clientY);
    });
  }

  /**
   * Nearest terrain summit dot to the cursor, within a small pixel radius, or null.
   * Distance is measured in projection units (like the star/DSO hit-tests) so it can
   * be compared against them. Only active in date mode with the mountain horizon shown.
   */
  private findClosestSummit(
    mx: number,
    my: number,
  ): { summit: HorizonSummit; dist: number } | null {
    return this.hitTest.findClosestSummit(
      mx,
      my,
      this.view,
      this.showMountainHorizon ? this.mountainProfile : null,
      this.computeHorizonParams(),
    );
  }

  /** Distance from the cursor to a sky object, in projection units. */
  private projDist(ra: number, dec: number, projPt: Point): number {
    const p = project(ra, dec);
    return Math.hypot(p.x - projPt.x, p.y - projPt.y);
  }

  private handleHover(mx: number, my: number, clientX: number, clientY: number) {
    const closestSummit = this.findClosestSummit(mx, my);
    const closestStar = this.findClosestStar(mx, my);
    const closestDSO = this.findClosestDSO(mx, my);

    // Verify that found objects would actually be rendered (not hidden by count limits)
    const starRendered = closestStar ? this.isStarRendered(closestStar) : false;
    const dsoRendered = closestDSO ? this.isDSORendered(closestDSO) : false;

    this.hoveredDSO = closestDSO && dsoRendered ? closestDSO : null;

    const projPt = fromCanvas(mx, my, this.view);

    // Winner selection + the sky-drift grace live in ./hover-resolve (pure, unit-tested).
    const res = resolveHover({
      summit: closestSummit ? { rendered: true, dist: closestSummit.dist } : null,
      star: closestStar
        ? { rendered: starRendered, dist: this.projDist(closestStar.ra, closestStar.dec, projPt) }
        : null,
      dso: closestDSO
        ? { rendered: dsoRendered, dist: this.projDist(closestDSO.ra, closestDSO.dec, projPt) }
        : null,
      mx,
      my,
      simMs: this.simDate.getTime(),
      anchor: this.hoverAnchor,
      gracePx: SkyMap.HOVER_DRIFT_GRACE_PX,
    });

    switch (res.kind) {
      case 'summit':
        this.onSummitHover?.(closestSummit!.summit, clientX, clientY);
        break;
      case 'star':
        this.onStarHover?.(closestStar, clientX, clientY);
        break;
      case 'dso':
        this.onDSOHover?.(closestDSO, clientX, clientY);
        break;
      case 'keep':
        // Sky drifted under a still cursor — leave the tooltip up, refresh the anchor.
        break;
      case 'dismiss':
        this.onStarHover?.(null, clientX, clientY);
        break;
    }
    this.hoverAnchor = res.kind === 'dismiss' ? null : res.anchor;
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
   * (see InteractionLod.effectiveStarBudget). When motion stops for SETTLE_MS, the
   * flag clears and a full-budget redraw runs so the less-important objects fill back
   * in. The timer always fires, so the flag can never get stuck on (e.g. an interrupted
   * animation). The adaptive-budget maths live in InteractionLod; SkyMap owns the timer.
   */
  private markInteracting() {
    this.lod.beginInteraction();
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      this.lod.endInteraction();
      this.requestRender();
    }, InteractionLod.SETTLE_MS);
  }

  /** Coalesced render for motion: throttles the density budget for a smooth frame. */
  requestRenderInteractive() {
    this.markInteracting();
    this.requestRender();
  }

  render() {
    const { ctx, view } = this;
    const { width, height } = view;

    // Time interactive frames to drive the adaptive budgets — plus a one-shot at-rest burst
    // right after DSO-auto is switched on (dsoCalibrating) so the slider re-tunes immediately.
    // Outside those, no measurement: the budget never creeps up at rest, so nothing pops when
    // a gesture starts.
    const measure = this.lod.shouldMeasure(this._renderingOffscreen);
    const t0 = measure ? performance.now() : 0;

    // Invalidate the per-frame DSO selection cache; rebuilt lazily by the first consumer.
    this.dsoSelection.invalidate();

    // Horizon params (LST + latitude), computed once per frame — null outside date mode
    // or before an observer location is set, in which case no dimming/line is drawn.
    const horizon = this.skyTimeMode === 'date' ? this.computeHorizonParams() : null;

    ctx.save();
    ctx.clearRect(0, 0, width, height);

    drawBackground(ctx, view, this.skyTheme, this.backgroundOpacity);

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
      drawConstellationLines(
        ctx,
        view,
        this.constellationStyle,
        this.skyTheme.constellationLineColor,
      );
    }
    if (this.showDSOs) {
      this.renderDSOs(horizon);
    }
    // Gated on date mode (not just showMoon) so the toggle's on/off state survives
    // switching in/out of date mode without the Moon reappearing in live/full mode,
    // where its position relative to "now" wouldn't be meaningful to show.
    if (this.showMoon && this.skyTimeMode === 'date') {
      this.renderMoon(horizon);
    }
    if (this.showSun && this.skyTimeMode === 'date') {
      this.renderSun(horizon);
    }
    if (this.showPlanets && this.skyTimeMode === 'date') {
      this.renderPlanets(horizon);
    }
    if (this.showStars) {
      this.renderStars(horizon);
      if (this.showStarLabels) {
        this.renderStarLabels();
      }
    }
    if (this.showDSOs && this.showDSOLabels) {
      this.renderDSOLabels();
    }
    if (this.showConstellationNames) {
      drawConstellationNames(ctx, view, this.skyTheme);
    }

    ctx.globalAlpha = 1;
    if (this.showGrid) {
      if (this.localSkyMode) {
        drawGridZenith(ctx, view, this.skyTheme);
      } else if (this.fisheyeMode) {
        drawFisheyeGrid(ctx, view, this.skyTheme);
      } else {
        drawGrid(ctx, view, this.skyTheme, this.borderLatDeg);
      }
    }
    if (horizon) {
      if (this.showAzimuthGrid) {
        drawAzimuthGrid(ctx, view, horizon.lstH, horizon.latDeg, this.skyTheme);
      }
      // --accent-color tracks the current warm/cold UI theme, so the horizon line
      // reads well regardless of theme instead of a fixed hardcoded hue.
      const cs = getComputedStyle(this.canvas);
      const horizonColor =
        cs.getPropertyValue('--accent-color').trim() || this.skyTheme.horizonLineColorFallback;
      drawHorizonLine(ctx, view, horizon.lstH, horizon.latDeg, horizonColor);
      // The terrain mass is drawn on the overlay canvas (above the photo layer) for live
      // renders, so photos sitting behind the mountains are correctly hidden rather than
      // painted on top of them — same pattern as FOV frames below. Offscreen/export renders
      // have no overlay canvas, so it's drawn inline here instead (see renderOverlay).
      if (this._renderingOffscreen) {
        this.renderMountainHorizon(ctx, horizon);
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
      if (this.frames.frames.length > 0) {
        this.renderFovInstances();
      }
    }

    ctx.restore(); // removes clip

    // ── Border ring (drawn after clip restore so it sits on top) ────────────
    ctx.save();
    ctx.beginPath();
    ctx.arc(poleOrigin.x, poleOrigin.y, borderR, 0, Math.PI * 2);
    ctx.strokeStyle = BORDER_RING.color;
    ctx.lineWidth = BORDER_RING.lineWidth;
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
      if (this.lod.autoDSODensity) {
        const r = this.lod.adaptAutoDensity(ms, this.maxDSOCount);
        if (r.changed) {
          this.maxDSOCount = r.next;
          this.onAutoDensityChange?.(r.next);
          this.requestRender();
        }
      } else if (this.lod.interacting) {
        this.lod.adaptInteractionQuality(ms);
      }
    }
  }

  private renderOverlay(): void {
    const oc = this.overlayCtx;
    if (!oc) return;
    const { view } = this;
    const { width, height } = view;

    oc.clearRect(0, 0, width, height);

    const horizon = this.skyTimeMode === 'date' ? this.computeHorizonParams() : null;
    const hasFrames = this.fovFrameSpecs.length > 0 || this.frames.frames.length > 0;
    const hasRegionDraw = this.regionDraw.active && this.regionDraw.capturedPoints.length > 0;
    const hasRegionOverlay = this.activeRegionOverlay !== null && this.localSkyMode;
    if (!horizon && !hasFrames && !hasRegionDraw && !hasRegionOverlay) return;

    const poleOrigin = toCanvas(0, 0, view);
    const borderR = borderRadiusPU(this.borderLatDeg) * view.scale;

    oc.save();
    oc.beginPath();
    oc.arc(poleOrigin.x, poleOrigin.y, borderR, 0, Math.PI * 2);
    oc.clip();

    // Terrain mass first (drawn above the photo layer so photos behind the mountains are
    // hidden — see the comment in the main render loop), then frames on top of that.
    if (horizon) {
      this.renderMountainHorizon(oc, horizon);
    }

    // Temporarily route ctx to the overlay canvas so renderFovFrames / renderFovInstances
    // draw there without any other changes to those methods.
    const mainCtx = this.ctx;
    this.ctx = oc;
    if (this.fovFrameSpecs.length > 0) this.renderFovFrames();
    if (this.frames.frames.length > 0) this.renderFovInstances();
    this.ctx = mainCtx;

    if (hasRegionOverlay) this.renderRegionOverlay(oc);
    if (hasRegionDraw) this.renderRegionDrawPreview(oc);

    // Cardinal labels last, so the N/E/S/W letters stay legible above the terrain
    // mass, the photo layer and the frames.
    if (horizon) this.renderCardinalPoints(oc, horizon);

    oc.restore();
  }

  /** Draws the red N/E/S/W horizon labels into `ctx`, if enabled. */
  private renderCardinalPoints(
    ctx: CanvasRenderingContext2D,
    horizon: { lstH: number; latDeg: number },
  ): void {
    if (!this.showCardinalPoints) return;
    drawCardinalPoints(ctx, this.view, horizon.lstH, horizon.latDeg, {
      n: t('cardinal.north'),
      e: t('cardinal.east'),
      s: t('cardinal.south'),
      w: t('cardinal.west'),
    });
  }

  /** Draws the saved region reference overlay (see setActiveRegionOverlay). */
  private renderRegionOverlay(ctx: CanvasRenderingContext2D): void {
    const region = this.activeRegionOverlay;
    const hp = this.computeHorizonParams();
    if (!region || !hp || region.points.length < 3) return;
    const { view } = this;
    ctx.save();
    ctx.beginPath();
    region.points.forEach((p, i) => {
      const { raDeg, decDeg } = raDecFromAltAz(p.altDeg, p.azDeg, hp.lstH, hp.latDeg);
      const proj = project(raDeg, decDeg);
      const c = toCanvas(proj.x, proj.y, view);
      if (i === 0) ctx.moveTo(c.x, c.y);
      else ctx.lineTo(c.x, c.y);
    });
    ctx.closePath();
    ctx.fillStyle = `${region.color}40`; // ~25% alpha
    ctx.fill();
    ctx.strokeStyle = region.color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  /** Draws the live in-progress freehand region stroke while drawing. */
  private renderRegionDrawPreview(ctx: CanvasRenderingContext2D): void {
    const hp = this.computeHorizonParams();
    const points = this.regionDraw.capturedPoints;
    if (!hp || points.length === 0) return;
    const { view } = this;
    ctx.save();
    ctx.beginPath();
    points.forEach((p, i) => {
      const { raDeg, decDeg } = raDecFromAltAz(p.altDeg, p.azDeg, hp.lstH, hp.latDeg);
      const proj = project(raDeg, decDeg);
      const c = toCanvas(proj.x, proj.y, view);
      if (i === 0) ctx.moveTo(c.x, c.y);
      else ctx.lineTo(c.x, c.y);
    });
    ctx.strokeStyle = '#4ea1ff';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.restore();
  }

  /** Draws the mountain-horizon terrain mass (+ summit dots) into `ctx`, if enabled. */
  private renderMountainHorizon(
    ctx: CanvasRenderingContext2D,
    horizon: { lstH: number; latDeg: number },
  ): void {
    if (!this.showMountainHorizon || !this.mountainProfile) return;
    drawMountainHorizon(ctx, this.view, horizon.lstH, horizon.latDeg, this.mountainProfile);
    if (this.mountainProfile.summits?.length) {
      drawSummitDots(ctx, this.view, horizon.lstH, horizon.latDeg, this.mountainProfile);
    }
  }

  private renderPhotoOutlines() {
    const { ctx } = this;

    for (const outline of this.photoOutlines) {
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

  private renderFovFrames() {
    const { ctx, view } = this;
    const cx = view.width / 2;
    const cy = view.height / 2;
    // These previews sit at the screen centre, so their scale is the projection's scale at
    // the sky point under it — measured, not derived from dec, which is the wrong quantity
    // once the projection is zenith-centred (see sky-axes.ts).
    const { ra, dec } = unproject(view.centerX, view.centerY);
    const pxPerDeg = canvasPxPerDeg(ra, dec, view);

    // Resolve CSS token values from computed style (canvas does not support CSS vars directly)
    const cs = getComputedStyle(this.canvas);
    const strokeColor = cs.getPropertyValue('--fov-frame-stroke').trim() || FRAME.strokeFallback;
    const labelColor = cs.getPropertyValue('--fov-frame-label').trim() || FRAME.labelFallback;

    for (const spec of this.fovFrameSpecs) {
      const halfWPx = (spec.wDeg / 2) * pxPerDeg;
      const halfHPx = (spec.hDeg / 2) * pxPerDeg;
      const corners = computeFovFrameCorners(halfWPx, halfHPx, cx, cy, this.fovRotationDeg);

      ctx.save();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = FRAME.lineWidth;
      ctx.setLineDash(FRAME.dashOutline);
      drawFramePolyline(ctx, corners);
      drawEdgeLabel(ctx, corners, spec.label, labelColor);
      ctx.restore();
    }
  }

  private renderFovInstances() {
    const { ctx } = this;
    const cs = getComputedStyle(this.canvas);
    const strokeColor = cs.getPropertyValue('--fov-frame-stroke').trim() || FRAME.strokeFallback;
    const labelColor = cs.getPropertyValue('--fov-frame-label').trim() || FRAME.labelFallback;
    const activeColor = cs.getPropertyValue('--accent-color').trim() || labelColor;
    const dangerColor = cs.getPropertyValue('--color-danger').trim() || FRAME.dangerFallback;
    // The selected mosaic's tiles each get a delete button (per-tile editing).
    const activeMosaicId = this.frames.frames
      .find((f) => f.active && f.isMosaicOutline)
      ?.id.split(':')[2];

    for (const f of this.frames.frames) {
      if (f.visible === false) continue; // hidden via the manager checkbox
      // Off-projection (below the Local Sky horizon, or the far hemisphere in fisheye):
      // project() returns a sentinel there, so the frame would be painted far off-canvas
      // with zero extents and degenerate handles. Skip it outright.
      if (f.anchorKind === 'sky' && !isSkyPointVisible(f.ra ?? 0, f.dec ?? 0)) continue;
      const { corners, cx, cy, rotDeg, halfW, halfH } = this.frames.frameGeometry(f);
      const isActive = f.active;
      const isTile = !!f.mosaicId; // a faint mosaic panel (the outline frame draws the rest)

      ctx.save();
      ctx.globalAlpha = isTile ? 0.4 : isActive ? 1 : 0.5;
      ctx.strokeStyle = isActive && !isTile ? activeColor : strokeColor;
      ctx.lineWidth = isActive && !isTile ? FRAME.lineWidthActive : FRAME.lineWidth;
      ctx.setLineDash(FRAME.dashOutline);
      // A mosaic outline traces its tile perimeter (follows projection curvature);
      // every other frame is its 4-corner rectangle.
      const outline = f.isMosaicOutline ? (this.frames.mosaicOutlinePath(f) ?? corners) : corners;
      drawFramePolyline(ctx, outline);

      if (isTile) {
        // Border tiles of the selected mosaic carry a delete button (large tiles only).
        if (
          f.mosaicId === activeMosaicId &&
          f.mosaicIsBorderTile &&
          this.frames.tileTrashVisible(halfW, halfH)
        ) {
          ctx.globalAlpha = 1;
          drawTileTrash(ctx, { x: cx, y: cy }, dangerColor);
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
        drawEdgeLabel(ctx, corners, f.name, isActive ? activeColor : labelColor);
      }

      // Handles on the active frame only (so other frames stay locked), and only
      // while the frame is large enough that the centre dot isn't near the edges.
      if (isActive && this.frames.frameHandlesVisible(halfW, halfH)) {
        drawFrameHandles(
          ctx,
          { corners, cx, cy, rotDeg, halfH },
          {
            movable: f.movable,
            pinnable: !!f.pinnable,
            resizable: !!f.resizable,
            anchorSky: f.anchorKind === 'sky',
          },
          activeColor,
          this.frames.framePinGlyphPos(corners[1], rotDeg),
        );
      }
      ctx.restore();
    }

    // Rubber-band preview of a drag-to-extend in progress.
    if (this.frames.resizeDraft) {
      const d = this.frames.resizeDraft;
      drawResizeDraftRect(
        ctx,
        computeFovFrameCorners(d.halfW, d.halfH, d.cx, d.cy, d.rotDeg),
        activeColor,
      );
    }

    // Elastic line: while moving a frame whose anchor will snap, a taut line runs
    // from the frame centre (cursor) to the pending DSO's centre. It tightens
    // (brighter + thicker) as the frame nears the break threshold, signalling the
    // snap-back that fires on release; it vanishes when the elastic "breaks".
    if (this.frames.snapCandidate && this.frames.activeDrag?.mode === 'move') {
      const f = this.frames.frames.find((x) => x.id === this.frames.activeDrag!.id);
      if (f) {
        const snap = this.frames.snapCandidate;
        const { cx, cy } = this.frames.frameAnchorCanvas(f);
        const dp = project(snap.ra, snap.dec);
        const dc = toCanvas(dp.x, dp.y, this.view);
        // Break radius mirrors findClosestDSO: the rendered ellipse, floored at 20px.
        const rx = Math.max(2, angularSizeToCanvasPx(snap.majAxis / 2, snap.dec, this.view.scale));
        const breakPx = Math.max(rx, 20);
        const tension = Math.min(1, Math.hypot(cx - dc.x, cy - dc.y) / breakPx);
        drawElasticSnapLine(ctx, { x: cx, y: cy }, dc, tension, activeColor);
      }
    }

    // Add ("+") buttons at the empty neighbour cells of the selected mosaic.
    if (
      activeMosaicId &&
      this.frames.mosaicAddCandidates.length &&
      this.frames.mosaicEditButtonsVisible(activeMosaicId)
    ) {
      const avoid = this.frames.activeOutlineRotateAvoid();
      for (const c of this.frames.mosaicAddCandidates)
        drawTileAdd(ctx, this.frames.candidateCanvasPoint(c, avoid), activeColor);
    }
  }

  /** Observer/time parameters for horizon visibility this frame — null when not applicable. */
  private computeHorizonParams(): { lstH: number; latDeg: number } | null {
    if (this.obsLat === null || this.obsLon === null) return null;
    const jd = dateToJD(this.simDate);
    return { lstH: lstHours(jd, this.obsLon), latDeg: this.obsLat };
  }

  private renderStars(horizon: { lstH: number; latDeg: number } | null) {
    const { ctx, view } = this;
    // Stars render at full opacity (not dimmed by skyOpacity like the rest of the
    // sky), so their opaque cores fully occlude constellation/grid lines behind
    // them instead of letting the line bleed through the middle of the star.
    const prevAlpha = ctx.globalAlpha;
    ctx.globalAlpha = 1;
    const stars = getStars();
    const theme = this.skyTheme;
    // Pan-invariant, area-weighted magnitude budget (see render-budget.ts). The precise
    // cutoff is per-position (starFaintLimitAt) — brighter near the crowded map centre,
    // fainter toward the edge — so on-screen star density stays uniform under the
    // stereographic projection's area distortion. `maxMag` here is the faintest limit
    // anywhere (the rim): it is the cheap pre-filter below and the single atlas/paint key
    // (so edge-fill stars share sprites and don't fade), while starFaintLimitAt applies
    // the exact per-star gate after projecting. Pan-invariant either way, so nothing pops
    // into the static part of the view while panning.
    const sb = this.starAreaBudget();
    const maxMag = sb.edgeMag;

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
    const drifted =
      liveRatio > SkyMap.ATLAS_REBUILD_RATIO || liveRatio < 1 / SkyMap.ATLAS_REBUILD_RATIO;
    if (atlasStale && (!this.lod.interacting || this.starSprites.size === 0 || drifted)) {
      this.starSprites.clear();
      this.starSpriteScale = atlasScale;
      this.starSpriteMaxMag = atlasMaxMag;
    }
    // Just-rebuilt frames draw crisp 1:1 (bucket matches); between rebuilds, scale the
    // frozen sprites by the radius ratio (≈ √ of the scale ratio, matching starRadius'
    // curve). At rest and during pan the bucket matches, so this stays 1.
    const frozenScale = this.starSpriteScale !== atlasScale;
    const spriteScale =
      frozenScale && this.starSpriteScale > 0 ? Math.sqrt(view.scale / this.starSpriteScale) : 1;

    for (const star of stars) {
      // Always include the highlighted star.
      const isHighlighted = this.highlightedStar === star.hip;

      if (!isHighlighted) {
        if (star.mag > maxMag) continue;
        if (this.localSkyMode) {
          // Below-horizon stars are already hidden by the horizon-circle canvas
          // clip; this just skips the projection/bbox work for them earlier.
          if (horizon && isBelowHorizonCached(star, horizon.lstH, horizon.latDeg)) continue;
        } else if (!this.fisheyeMode) {
          // Dec pre-filter: skip objects clearly outside the border (stereo only —
          // in fisheye the far hemisphere is clipped by project() returning off-canvas).
          if (this.hemisphere === 'north' && star.dec < -(this.borderLatDeg + 2)) continue;
          if (this.hemisphere === 'south' && star.dec > +(this.borderLatDeg + 2)) continue;
        }
      }

      projectCached(star);

      // Area-weighted per-position gate: thin the crowded centre, keep the naked-eye
      // floor everywhere, allow fainter fill toward the edge. Runs after projecting so
      // it can read the local area factor from the cached _px/_py.
      if (!isHighlighted && star.mag > starFaintLimitAt(star._px!, star._py!, sb)) {
        continue;
      }

      const c = toCanvas(star._px!, star._py!, view);

      // Skip if off-screen (with margin)
      if (c.x < -20 || c.x > view.width + 20 || c.y < -20 || c.y > view.height + 20) {
        continue;
      }

      // Below-horizon stars are dimmed (not hidden) in date mode, once a location is set.
      // The highlighted star stays at full brightness regardless (it's actively selected).
      ctx.globalAlpha =
        horizon && !isHighlighted && isBelowHorizonCached(star, horizon.lstH, horizon.latDeg)
          ? SkyMap.BELOW_HORIZON_ALPHA
          : 1;

      if (isHighlighted) {
        // Drawn live (not via the atlas): rare, uses estab=1, and gets a ring.
        const paint = computeStarPaint(star.mag, star.bv, view.scale, maxMag, theme, true);
        paintStar(ctx, c.x, c.y, paint);
        ctx.strokeStyle = HIGHLIGHT_RING.color;
        ctx.lineWidth = HIGHLIGHT_RING.lineWidth;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(c.x, c.y, paint.radius + HIGHLIGHT_RING.padPx, 0, Math.PI * 2);
        ctx.stroke();
        continue;
      }

      // Glow halos (bright stars, mag < glowThresholdMag) are a soft radial gradient
      // several times the dot's radius — the 1.3x atlas drift bound (imperceptible on
      // small solid dots) is visibly blurry on them. Only ~321 stars catalog-wide are
      // glow-eligible, so draw them live at the true zoom scale during the drift window
      // instead of blitting the frozen/scaled sprite — same treatment as the highlighted
      // star above, gated to the exact frames (frozenScale) where the blur would show.
      if (frozenScale && star.mag < theme.glowThresholdMag) {
        const paint = computeStarPaint(star.mag, star.bv, view.scale, maxMag, theme, false);
        paintStar(ctx, c.x, c.y, paint);
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
        const paint = computeStarPaint(
          star.mag,
          star.bv,
          this.starSpriteScale,
          this.starSpriteMaxMag,
          theme,
          false,
        );
        sprite = buildStarSprite(paint);
        this.starSprites.set(key, sprite);
      }
      if (spriteScale === 1) {
        ctx.drawImage(sprite.canvas, c.x - sprite.half, c.y - sprite.half);
      } else {
        const h = sprite.half * spriteScale;
        ctx.drawImage(
          sprite.canvas,
          c.x - h,
          c.y - h,
          sprite.canvas.width * spriteScale,
          sprite.canvas.height * spriteScale,
        );
      }
    }

    ctx.globalAlpha = prevAlpha;
  }

  private renderStarLabels() {
    const { ctx, view } = this;
    const stars = getStars();

    ctx.font = FONTS.starLabel;
    ctx.fillStyle = this.skyTheme.starLabelColor;
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
   * The DSOs to draw this frame. The selection logic, its position index and its
   * per-frame cache live in ./dso-render-select (unit-tested); this binds the live
   * view and display state. Single source of truth shared by renderDSOs,
   * renderDSOLabels and isDSORendered, so drawing and hit-testing always agree.
   */
  private selectRenderedDSOs(): DSO[] {
    return this.dsoSelection.select({
      view: this.view,
      borderLatDeg: this.borderLatDeg,
      hemisphere: this.hemisphere,
      localSkyMode: this.localSkyMode,
      fisheyeMode: this.fisheyeMode,
      visibleTypes: this.visibleDSOTypes,
      visibleCatalogs: this.visibleDSOCatalogs,
      highlightedId: this.highlightedDSO,
      horizon: this.localSkyMode ? this.computeHorizonParams() : null,
      priorityThreshold: this.dsoPriorityThreshold(),
    });
  }

  private renderDSOs(horizon: { lstH: number; latDeg: number } | null) {
    const { ctx, view } = this;

    // Render the selected DSOs
    for (const dso of this.selectRenderedDSOs()) {
      projectCached(dso);
      const c = toCanvas(dso._px!, dso._py!, view);

      // Compute below-horizon state (and, as a side effect, _altDeg) before the size
      // calc: in zenith ("local sky") mode, angular size must scale with altitude
      // (the projection's pole), not dec — see dsoSizeCos2.
      const isHighlighted = dso.id === this.highlightedDSO;
      const isBelowHorizon = !!horizon && isBelowHorizonCached(dso, horizon.lstH, horizon.latDeg);

      const majorArcmin = dso.majAxis ?? 1;
      const minorArcmin = dso.minAxis ?? majorArcmin;
      const cos2 = dsoSizeCos2(dso, this.localSkyMode ? dso._altDeg : undefined);
      const rx = Math.max(2, angularSizeToCanvasPx(majorArcmin / 2, dso.dec, view.scale, cos2));
      const ry = Math.max(2, angularSizeToCanvasPx(minorArcmin / 2, dso.dec, view.scale, cos2));
      const angle = dsoCanvasAngle(dso, view.rotationDeg);

      // Opacity based on magnitude
      const mag = dso.mag ?? 10;
      const opacity = Math.min(1, Math.max(0.3, 1 - (mag - 4) * 0.07));
      // Below-horizon DSOs are dimmed (not hidden) in date mode, once a location is set.
      // The highlighted DSO stays at full brightness regardless (it's actively selected).
      const horizonMul = !isHighlighted && isBelowHorizon ? SkyMap.BELOW_HORIZON_ALPHA : 1;

      ctx.save();
      ctx.globalAlpha = opacity * this.skyOpacity * horizonMul;
      ctx.translate(c.x, c.y);
      ctx.rotate(angle);

      drawDsoMarker(ctx, dso.type, rx, ry);

      // Highlight indicator for searched DSO
      if (isHighlighted) {
        drawDsoHighlightRing(ctx, rx, ry);
      }

      ctx.restore();
    }
  }

  /**
   * Draws the Moon at its position for the current instant: real "now" in live mode
   * (so the Moon toggle works even outside date mode), or the simulated date/time in
   * date mode. Below-horizon dimming only applies in date mode with a location set —
   * `horizon` is always null in live mode, so the Moon simply never dims there.
   */
  private renderMoon(horizon: { lstH: number; latDeg: number } | null) {
    const { ctx, view } = this;
    const date = this.skyTimeMode === 'live' ? new Date() : this.simDate;
    const jd = dateToJD(date);
    const { raDeg, decDeg } = moonRaDecDeg(jd);
    const { phaseIndex } = moonPhase(jd);

    // Computed once up front (rather than after sizing, as before) because in
    // zenith ("local sky") mode the altitude both gates visibility and drives the
    // apparent-size formula below — see dsoSizeCos2's doc comment for why altitude
    // (not dec) is the correct colatitude input while the projection is zenith-centred.
    const moonAltDeg = horizon
      ? altAzFromRaDec(raDeg, decDeg, horizon.lstH, horizon.latDeg).altDeg
      : null;

    if (this.localSkyMode) {
      // Below-horizon is already hidden by the horizon-circle canvas clip; this
      // just skips the projection/size work for it earlier.
      if (moonAltDeg !== null && moonAltDeg < 0) return;
    } else if (!this.fisheyeMode) {
      // Dec pre-filter, same convention as stars/DSOs (stereo only — fisheye clips via project()).
      if (this.hemisphere === 'north' && decDeg < -(this.borderLatDeg + 2)) return;
      if (this.hemisphere === 'south' && decDeg > +(this.borderLatDeg + 2)) return;
    }

    // The Moon's RA/Dec changes continuously, so it's projected directly (not via
    // projectCached, which is keyed on the hemisphere/mode generation and would go stale).
    const p = project(raDeg, decDeg);
    if (p.x >= 1e5) return; // far hemisphere (fisheye) / below horizon (zenith fisheye)
    const c = toCanvas(p.x, p.y, view);
    if (c.x < -50 || c.x > view.width + 50 || c.y < -50 || c.y > view.height + 50) return;

    const cos2 =
      this.localSkyMode && moonAltDeg !== null
        ? Math.cos(((90 - moonAltDeg) * DEG2RAD) / 2) ** 2
        : undefined;
    // 15 arcmin ≈ half the Moon's true ~30' diameter; floored so it reads as a disk
    // (not a speck) at typical zoom levels, same floor pattern as DSO marker sizing.
    const r = Math.max(7, angularSizeToCanvasPx(15, decDeg, view.scale, cos2));

    const belowHorizon = moonAltDeg !== null && moonAltDeg < 0;

    ctx.save();
    ctx.globalAlpha = belowHorizon ? SkyMap.BELOW_HORIZON_ALPHA : 1;
    drawMoonMarker(ctx, c.x, c.y, r, phaseIndex, {
      litFill: this.skyTheme.moonLitColor,
      shadowFill: this.skyTheme.moonShadowColor,
      outline: this.skyTheme.moonOutlineColor,
    });
    ctx.restore();
  }

  private static readonly SUN_RADIUS_PX = 6;
  private static readonly PLANET_RADIUS_PX = 3.5;

  private planetLabelKey(planet: PlanetKey): string {
    return `planets.${planet}`;
  }

  private planetColor(planet: PlanetKey): string {
    const theme = this.skyTheme;
    switch (planet) {
      case 'mercury':
        return theme.mercuryColor;
      case 'venus':
        return theme.venusColor;
      case 'mars':
        return theme.marsColor;
      case 'jupiter':
        return theme.jupiterColor;
      case 'saturn':
        return theme.saturnColor;
      case 'uranus':
        return theme.uranusColor;
      case 'neptune':
        return theme.neptuneColor;
    }
  }

  /** Renders a single point-like body (Sun or planet): a colored dot plus a name label. */
  private renderCelestialBody(
    horizon: { lstH: number; latDeg: number } | null,
    raDeg: number,
    decDeg: number,
    radiusPx: number,
    fillColor: string,
    label: string,
  ) {
    const { ctx, view } = this;
    const altDeg = horizon
      ? altAzFromRaDec(raDeg, decDeg, horizon.lstH, horizon.latDeg).altDeg
      : null;

    if (this.localSkyMode) {
      if (altDeg !== null && altDeg < 0) return;
    } else if (!this.fisheyeMode) {
      if (this.hemisphere === 'north' && decDeg < -(this.borderLatDeg + 2)) return;
      if (this.hemisphere === 'south' && decDeg > +(this.borderLatDeg + 2)) return;
    }

    const p = project(raDeg, decDeg);
    if (p.x >= 1e5) return;
    const c = toCanvas(p.x, p.y, view);
    if (c.x < -50 || c.x > view.width + 50 || c.y < -50 || c.y > view.height + 50) return;

    const belowHorizon = altDeg !== null && altDeg < 0;

    ctx.save();
    ctx.globalAlpha = belowHorizon ? SkyMap.BELOW_HORIZON_ALPHA : 1;
    drawBodyMarker(ctx, c.x, c.y, radiusPx, fillColor, this.skyTheme.bodyOutlineColor);
    drawBodyLabel(ctx, c.x, c.y, radiusPx, label, this.skyTheme.bodyLabelColor, FONTS.bodyLabel);
    ctx.restore();
  }

  private renderSun(horizon: { lstH: number; latDeg: number } | null) {
    const date = this.skyTimeMode === 'live' ? new Date() : this.simDate;
    const jd = dateToJD(date);
    const { raDeg, decDeg } = sunRaDecDeg(jd);
    this.renderCelestialBody(
      horizon,
      raDeg,
      decDeg,
      SkyMap.SUN_RADIUS_PX,
      this.skyTheme.sunColor,
      t('planets.sun'),
    );
  }

  private renderPlanets(horizon: { lstH: number; latDeg: number } | null) {
    const date = this.skyTimeMode === 'live' ? new Date() : this.simDate;
    const jd = dateToJD(date);
    for (const planet of PLANET_KEYS) {
      const { raDeg, decDeg } = planetRaDecDeg(jd, planet);
      this.renderCelestialBody(
        horizon,
        raDeg,
        decDeg,
        SkyMap.PLANET_RADIUS_PX,
        this.planetColor(planet),
        t(this.planetLabelKey(planet)),
      );
    }
  }

  private renderDSOLabels() {
    const { ctx, view } = this;
    ctx.textBaseline = 'middle';

    // Render labels for exactly the DSOs drawn this frame (shared selection).
    // In zenith mode, _altDeg is already fresh here — renderDSOs (or
    // selectRenderedDSOs' own pre-filter) already ran isBelowHorizonCached on
    // every one of these DSOs earlier in this same render pass.
    for (const dso of this.selectRenderedDSOs()) {
      const majorArcmin = dso.majAxis ?? 1;
      const rx = angularSizeToCanvasPx(
        majorArcmin / 2,
        dso.dec,
        view.scale,
        dsoSizeCos2(dso, this.localSkyMode ? dso._altDeg : undefined),
      );
      if (!dsoLabelVisible(dso, rx, view)) continue;

      projectCached(dso);
      const c = toCanvas(dso._px!, dso._py!, view);

      ctx.font = FONTS.dsoLabel;
      ctx.fillStyle = DSO_LABEL_COLORS[dso.type] ?? DEFAULT_DSO_LABEL_COLOR;
      ctx.fillText(formatDsoLabel(dso), c.x + Math.max(2, rx) + 2, c.y);
    }

    ctx.textBaseline = 'alphabetic';
  }
}
