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
import {
  project,
  toCanvas,
  fromCanvas,
  unproject,
  setHemisphere,
  fitScaleForBorderCircle,
  borderRadiusPU,
  bumpObsGeneration,
  setCenterMode,
  setProjectionObserver,
} from './projection';
import { dateToJD, lstHours } from './astro-time';
import { altAzFromRaDec } from './sky-geometry';
import { getStarMagsSorted, loadConstellationStyle } from './star-catalog';
import { getDSOs } from './dso-catalog';
import { targetRenderCount, DSO_DENSITY_K, MIN_BUDGET_MULT } from './render-budget';
import { starAreaBudget, starMagThreshold, type StarAreaBudget } from './star-budget';
import { SKY_THEME } from './sky-themes';
import { computeMaxMag } from './star-render-math';
import { InteractionLod } from './interaction-lod';
import {
  pointInConvexPolygon,
  photoLabelEdgeIndex,
  photoLabelTransform,
  findTopPhotoOutlineAtPoint,
  type PhotoOutline,
} from './photo-outline';
import { computeFovFrameCorners } from './frame-geometry';
import { easeInOutCubic, navigateDurationMs, navigateProfile } from './sky-view-math';
import { resolveHover } from './hover-resolve';
import { StarSpriteAtlas } from './star-sprite-atlas';
import type { SkyScene, SkyLayerFlags } from './sky-scene';
import {
  renderStars,
  renderStarLabels,
  renderDSOs,
  renderDSOLabels,
  renderMoon,
  renderSun,
  renderPlanets,
} from './sky-scene-render';
import {
  renderOverlay,
  renderMountainHorizon,
  renderPhotoOutlines,
  renderFovFrames,
  renderFovInstances,
} from './sky-frame-render';
import { RegionDrawGesture } from './sky-region-draw';
import { FrameController, type FrameHost } from './frame-controller';
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
  drawAzimuthGrid,
} from './sky-draw';
import { BORDER_RING } from './canvas-theme';

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
  // Distinct quantized (mag, bv) sprites pre-rendered for the current zoom, so a pan
  // reuses every sprite instead of rebuilding ~15-stop gradients per star. The rebuild
  // policy lives in ./star-sprite-atlas (unit-tested).
  private starAtlas = new StarSpriteAtlas();

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
    this.frames = new FrameController(this.frameHost());
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
  private starAreaBudget(view: ViewState = this.view): StarAreaBudget {
    return starAreaBudget(
      view,
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
   * Pan-invariant DSO priority cutoff for the given zoom + canvas. A DSO renders iff
   * `dso.priority < this` (priority is a dense global blue-noise rank, lower = drawn
   * first). Independent of pan, mirroring {@link starMagThreshold}.
   */
  private dsoPriorityThreshold(view: ViewState = this.view): number {
    const { scale, width, height } = view;
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
    layers?: Partial<SkyLayerFlags>,
  ): void {
    const tctx = target.getContext('2d');
    if (!tctx) return;
    // A different scene, not a different SkyMap: the live ctx, view and layer flags are
    // never touched, so an export can't leak state into the on-screen map.
    const scene = this.buildScene({ ctx: tctx, view, offscreen: true, ...layers });
    tctx.save();
    tctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
    try {
      this.renderScene(scene);
    } finally {
      tctx.restore();
      // The export shares the per-frame DSO cache, which is now keyed to the export
      // view; drop it so the next on-screen frame rebuilds for the live view.
      this.dsoSelection.invalidate();
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
   * Adapter handed to ./frame-controller.
   *
   * The live values (view, interaction flags) are exposed as getters so the controller
   * always sees current state rather than a snapshot. Each getter delegates to an arrow
   * closure captured here: an object-literal getter would rebind `this` to the literal,
   * and aliasing `this` into a local to work around that trips `no-this-alias`.
   */
  private frameHost(): FrameHost {
    const view = () => this.view;
    const interactionEnabled = () => this.interactionEnabled;
    const pickingMode = () => this.pickingMode;
    return {
      get view() {
        return view();
      },
      get interactionEnabled() {
        return interactionEnabled();
      },
      get pickingMode() {
        return pickingMode();
      },
      findClosestDSO: (mx, my) => this.findClosestDSO(mx, my),
      dsosInFrame: (f) => this.dsosInFrame(f),
      requestRenderInteractive: () => this.requestRenderInteractive(),
      render: () => this.render(),
      navigateTo: (ra, dec, scale, animate) => this.navigateTo(ra, dec, scale, animate),
    };
  }

  /**
   * Adapter handed to ./sky-map-events, which owns the pointer/keyboard routing.
   * Live values are getters over arrow closures — see {@link frameHost}.
   */
  private eventHost(): SkyEventHost {
    const canvas = () => this.canvas;
    const view = () => this.view;
    const borderLatDeg = () => this.borderLatDeg;
    const interactionEnabled = () => this.interactionEnabled;
    const pickingMode = () => this.pickingMode;
    const photoOutlines = () => this.photoOutlines;
    const hoveredDSO = () => this.hoveredDSO;
    return {
      get canvas() {
        return canvas();
      },
      get view() {
        return view();
      },
      get borderLatDeg() {
        return borderLatDeg();
      },
      get interactionEnabled() {
        return interactionEnabled();
      },
      get pickingMode() {
        return pickingMode();
      },
      get photoOutlines() {
        return photoOutlines();
      },
      get hoveredDSO() {
        return hoveredDSO();
      },
      hasSelection: () => this.highlightedDSO !== null || this.highlightedStar !== null,

      regionDrawActive: () => this.regionDraw.active,
      regionDrawCapturing: () => this.regionDraw.capturing,
      regionDrawPress: () => this.regionDraw.press(),
      regionDrawMove: (pt) => this.regionDraw.move(pt),
      regionDrawFinish: (cancelled) => this.finishRegionDraw(cancelled),
      canvasToAltAz: (mx, my) => this.canvasToAltAz(mx, my),

      frameMouseDown: (mx, my) => this.frames.handleMouseDown(mx, my),
      frameDragActive: () => this.frames.activeDrag !== null,
      frameDragMove: (mx, my) => this.frames.handleDragMove(mx, my),
      frameMouseUp: () => this.frames.handleMouseUp(),
      frameHasActive: () => this.frames.hasActiveFrame(),
      frameClearInteraction: () => this.frames.clearInteraction(),
      frameSelect: (id) => this.frames.selectFrame(id),

      cancelAnimation: () => this.cancelAnimation(),
      dismissTooltip: () => this.dismissTooltip(),
      requestHover: (mx, my, cx, cy) => this.requestHover(mx, my, cx, cy),
      requestRenderInteractive: () => this.requestRenderInteractive(),
      render: () => this.render(),
      viewChanged: () => this.onViewChange?.(),
      findClosestStar: (mx, my) => this.findClosestStar(mx, my),
      exitPickingMode: () => this.exitPickingMode(),

      hasStarPickedHandler: () => this.onStarPicked !== null,
      hasPhotoClickHandler: () => this.onPhotoClick !== null,
      emitStarPicked: (star) => this.onStarPicked?.(star),
      emitPhotoClick: (name) => this.onPhotoClick?.(name),
      emitDSOClick: () => {
        const dso = this.hoveredDSO;
        if (!dso) return;
        this.onDSOClick?.(dso);
        // A one-shot picker (e.g. choosing a mosaic target) fires after the
        // normal selection so the click still selects the DSO as usual.
        if (this.onNextDSOPick) {
          const cb = this.onNextDSOPick;
          this.onNextDSOPick = null;
          cb(dso);
        }
      },
      emitClearSelection: () => this.onClearSelection?.(),
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

  /**
   * Build the render context for one pass. Everything the draw passes read is gathered
   * here, so an off-screen/export render is just a scene with a different ctx/view/layer
   * flags — the live map's own state is never mutated (see {@link renderToCanvas}).
   */
  private buildScene(over: Partial<SkyScene> = {}): SkyScene {
    const canvas = this.canvas;
    // The view may be overridden (export), and the density budgets/selection depend
    // on it, so resolve it before computing anything view-derived.
    const view = over.view ?? this.view;
    return {
      ctx: this.ctx,
      view,
      theme: this.skyTheme,
      horizon: this.skyTimeMode === 'date' ? this.computeHorizonParams() : null,
      offscreen: this._renderingOffscreen,

      hemisphere: this.hemisphere,
      borderLatDeg: this.borderLatDeg,
      localSkyMode: this.localSkyMode,
      fisheyeMode: this.fisheyeMode,

      skyOpacity: this.skyOpacity,
      backgroundOpacity: this.backgroundOpacity,
      belowHorizonAlpha: SkyMap.BELOW_HORIZON_ALPHA,

      skyTimeMode: this.skyTimeMode,
      simDate: this.simDate,
      showMoon: this.showMoon,
      showSun: this.showSun,
      showPlanets: this.showPlanets,
      showAzimuthGrid: this.showAzimuthGrid,
      showMountainHorizon: this.showMountainHorizon,
      showCardinalPoints: this.showCardinalPoints,
      mountainProfile: this.mountainProfile,

      showStars: this.showStars,
      showDSOs: this.showDSOs,
      showConstellationLines: this.showConstellationLines,
      showConstellationNames: this.showConstellationNames,
      showGrid: this.showGrid,
      showStarLabels: this.showStarLabels,
      showDSOLabels: this.showDSOLabels,

      highlightedStar: this.highlightedStar,
      highlightedDSO: this.highlightedDSO,

      starBudget: this.starAreaBudget(view),
      atlas: this.starAtlas,
      interacting: this.lod.interacting,

      selectedDSOs: () => this.selectRenderedDSOs(view),

      showPhotoOutlines: this.showPhotoOutlines,
      photoOutlines: this.photoOutlines,
      fovFrameSpecs: this.fovFrameSpecs,
      fovRotationDeg: this.fovRotationDeg,
      frames: this.frames,
      regionDrawPoints: this.regionDraw.capturedPoints,
      regionDrawActive: this.regionDraw.active,
      activeRegionOverlay: this.activeRegionOverlay,

      // Canvas has no CSS vars, so design tokens are resolved from computed style.
      cssVar: (name, fallback) =>
        getComputedStyle(canvas).getPropertyValue(name).trim() || fallback,

      ...over,
    };
  }

  render() {
    this.renderScene(this.buildScene());
  }

  /**
   * Draw one scene. `render()` passes the live scene; the export path passes one with
   * a different ctx/view/layers ({@link renderToCanvas}), which is why nothing here
   * reads `this.view` or `this.ctx` directly.
   */
  private renderScene(scene: SkyScene): void {
    const { ctx, view } = scene;
    const { width, height } = view;

    // Time interactive frames to drive the adaptive budgets — plus a one-shot at-rest burst
    // right after DSO-auto is switched on (dsoCalibrating) so the slider re-tunes immediately.
    // Outside those, no measurement: the budget never creeps up at rest, so nothing pops when
    // a gesture starts.
    const measure = this.lod.shouldMeasure(scene.offscreen);
    const t0 = measure ? performance.now() : 0;

    // Invalidate the per-frame DSO selection cache; rebuilt lazily by the first consumer.
    this.dsoSelection.invalidate();

    // Horizon params (LST + latitude), computed once per frame — null outside date mode
    // or before an observer location is set, in which case no dimming/line is drawn.
    const horizon = scene.horizon;

    ctx.save();
    ctx.clearRect(0, 0, width, height);

    drawBackground(ctx, view, scene.theme, scene.backgroundOpacity);

    // ── Hemisphere clip circle ──────────────────────────────────────────────
    // In stereo mode: borderLatDeg determines how far into the opposite hemisphere we show.
    // In fisheye mode: borderRadiusPU() returns 1.0 (the horizon circle).
    const poleOrigin = toCanvas(0, 0, view);
    const borderR = borderRadiusPU(scene.borderLatDeg) * view.scale;

    ctx.save();
    ctx.beginPath();
    ctx.arc(poleOrigin.x, poleOrigin.y, borderR, 0, Math.PI * 2);
    ctx.clip();

    ctx.globalAlpha = scene.skyOpacity;
    if (scene.showConstellationLines) {
      drawConstellationLines(
        ctx,
        view,
        this.constellationStyle,
        scene.theme.constellationLineColor,
      );
    }
    if (scene.showDSOs) {
      renderDSOs(scene);
    }
    // Gated on date mode (not just showMoon) so the toggle's on/off state survives
    // switching in/out of date mode without the Moon reappearing in live/full mode,
    // where its position relative to "now" wouldn't be meaningful to show.
    if (scene.showMoon && scene.skyTimeMode === 'date') {
      renderMoon(scene);
    }
    if (scene.showSun && scene.skyTimeMode === 'date') {
      renderSun(scene);
    }
    if (scene.showPlanets && scene.skyTimeMode === 'date') {
      renderPlanets(scene);
    }
    if (scene.showStars) {
      renderStars(scene);
      if (scene.showStarLabels) {
        renderStarLabels(scene);
      }
    }
    if (scene.showDSOs && scene.showDSOLabels) {
      renderDSOLabels(scene);
    }
    if (scene.showConstellationNames) {
      drawConstellationNames(ctx, view, scene.theme);
    }

    ctx.globalAlpha = 1;
    if (scene.showGrid) {
      if (scene.localSkyMode) {
        drawGridZenith(ctx, view, scene.theme);
      } else if (scene.fisheyeMode) {
        drawFisheyeGrid(ctx, view, scene.theme);
      } else {
        drawGrid(ctx, view, scene.theme, scene.borderLatDeg);
      }
    }
    if (horizon) {
      if (scene.showAzimuthGrid) {
        drawAzimuthGrid(ctx, view, horizon.lstH, horizon.latDeg, scene.theme);
      }
      // Only in the pole-centred view, where the horizon is a genuine curve across the
      // map. In Local Sky the projection is zenith-centred, so the horizon IS the border
      // circle (borderRadiusPU returns 1.0 = alt 0) — drawing it again just repaints the
      // rim in the accent colour, and since alt 0 sits exactly on the projection's
      // visibility boundary, rounding drops about half the azimuths and it lands as a
      // partial orange arc over one side of the ring.
      if (!scene.localSkyMode) {
        // --accent-color tracks the current warm/cold UI theme, so the horizon line
        // reads well regardless of theme instead of a fixed hardcoded hue.
        const horizonColor = scene.cssVar('--accent-color', scene.theme.horizonLineColorFallback);
        drawHorizonLine(ctx, view, horizon.lstH, horizon.latDeg, horizonColor);
      }
      // The terrain mass is drawn on the overlay canvas (above the photo layer) for live
      // renders, so photos sitting behind the mountains are correctly hidden rather than
      // painted on top of them — same pattern as FOV frames below. Offscreen/export renders
      // have no overlay canvas, so it's drawn inline here instead (see renderOverlay).
      if (scene.offscreen) {
        renderMountainHorizon(scene, horizon);
      }
    }
    if (scene.showPhotoOutlines && scene.photoOutlines.length > 0) {
      renderPhotoOutlines(scene);
    }
    // Frames are drawn on the overlay canvas (above photos) for live renders,
    // but inline here for offscreen/export renders (see renderOverlay / scene.offscreen).
    if (scene.offscreen) {
      if (scene.fovFrameSpecs.length > 0) {
        renderFovFrames(scene);
      }
      if (scene.frames.frames.length > 0) {
        renderFovInstances(scene);
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

    // The overlay is the same scene painted onto the overlay canvas (which sits above
    // the photo layer), so photos behind frames/terrain are hidden rather than covered.
    if (!scene.offscreen && this.overlayCtx) {
      renderOverlay({ ...scene, ctx: this.overlayCtx });
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

  /** Observer/time parameters for horizon visibility this frame — null when not applicable. */
  private computeHorizonParams(): { lstH: number; latDeg: number } | null {
    if (this.obsLat === null || this.obsLon === null) return null;
    const jd = dateToJD(this.simDate);
    return { lstH: lstHours(jd, this.obsLon), latDeg: this.obsLat };
  }

  /**
   * The DSOs to draw this frame. The selection logic, its position index and its
   * per-frame cache live in ./dso-render-select (unit-tested); this binds the display
   * state. Single source of truth shared by the shape pass, the label pass and
   * isDSORendered, so drawing and hit-testing always agree.
   */
  private selectRenderedDSOs(view: ViewState = this.view): DSO[] {
    return this.dsoSelection.select({
      view,
      borderLatDeg: this.borderLatDeg,
      hemisphere: this.hemisphere,
      localSkyMode: this.localSkyMode,
      fisheyeMode: this.fisheyeMode,
      visibleTypes: this.visibleDSOTypes,
      visibleCatalogs: this.visibleDSOCatalogs,
      highlightedId: this.highlightedDSO,
      horizon: this.localSkyMode ? this.computeHorizonParams() : null,
      priorityThreshold: this.dsoPriorityThreshold(view),
    });
  }
}
