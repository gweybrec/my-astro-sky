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
  getProjectionGeneration,
  toCanvas,
  fromCanvas,
  unproject,
  setHemisphere,
  getHemisphere,
  fitScaleForBorderCircle,
  borderRadiusPU,
  isInsideBorderCircle,
  getProjectionMode,
  bumpObsGeneration,
  isBelowHorizonCached,
  setCenterMode,
  setProjectionObserver,
  projectionAreaFactor,
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
import { clampSmartMosaicSize } from './mosaic';
import { getStars, getStarMagsSorted, loadConstellationStyle, normalizeRA } from './star-catalog';
import { getDSOs, getDSOById, getDSOImportanceRank } from './dso-catalog';
import {
  selectDSOsToRender,
  DSO_CONTAINER_VISIBLE_RADIUS_PX,
  type SelectableDSO,
} from './dso-selection';
import {
  targetRenderCount,
  magThresholdForCount,
  STAR_DENSITY_K,
  DSO_DENSITY_K,
  MIN_BUDGET_MULT,
  STAR_BRIGHT_FLOOR_MAG,
  areaNormForBorderRadius,
  areaWeightedBudget,
} from './render-budget';
import { frameTargetDso } from './fov-frame-target';
import { SpatialIndex } from './spatial-index';
import {
  isNearPolygonBorder,
  isNearHandle,
  rotateHandlePos,
  canvasRotationDegFromCursor,
  resizeFromCorner,
} from './fov-frame-geometry';
import { computeFovTargetScale } from './gear-presets';
import { SKY_THEME } from './sky-themes';
import { computeMaxMag, starRadius, atlasScaleBucket, computeStarPaint } from './star-render-math';
import { paintStar, buildStarSprite } from './star-draw';
import {
  angularSizeToCanvasPx,
  dsoSizeCos2,
  dsoCanvasAngle,
  DSO_GIANT_BODY_PU,
} from './dso-render-math';
import { InteractionLod } from './interaction-lod';
import {
  pointInConvexPolygon,
  photoLabelEdgeIndex,
  photoLabelTransform,
  findTopPhotoOutlineAtPoint,
  type PhotoOutline,
} from './photo-outline';
import {
  computeFovFrameCorners,
  frameAnchorCanvas,
  canvasRotDegToPa,
  frameCanvasRotationDeg,
  frameGeometry,
  mosaicOutlinePath,
  frameHandlesVisible,
  framePinGlyphPos,
  type FrameGeometry,
} from './frame-geometry';
import { findMergeTarget, resizeRegionFromDraft, type ResizeDraft } from './frame-interaction';
import { canvasPxPerDeg, isSkyPointVisible } from './sky-axes';
import {
  easeInOutCubic,
  navigateDurationMs,
  navigateProfile,
  zoomAboutPoint,
} from './sky-view-math';
import { pickDsoAtCursor } from './hover-hit-test';
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
  TILE_TRASH_R,
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
  private frameDrag: { id: string; mode: 'move' | 'rotate' | 'resize'; corner?: number } | null =
    null;
  // Transient rubber-band rectangle shown while a resize drag is in progress.
  private resizeDraft: ResizeDraft | null = null;
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

  // Freehand sky-region drawing (Local Sky / zenith view only, see enterRegionDrawMode).
  // regionDrawActive spans the whole gesture (mousedown → mouseup); regionDrawing is
  // true only while the mouse button is held (so mousemove before the first press,
  // impossible in practice, is never captured as a point).
  private regionDrawActive = false;
  private regionDrawing = false;
  private regionDrawPoints: { azDeg: number; altDeg: number }[] = [];
  // Local Sky mode state to restore once drawing finishes/cancels, so forcing it on
  // for the gesture never clobbers whatever the user had before.
  private regionDrawPrevLocalSkyMode = false;
  private onRegionDrawComplete: ((points: { azDeg: number; altDeg: number }[]) => void) | null =
    null;
  private onRegionDrawCancel: (() => void) | null = null;
  // A saved region shown on the map for reference (see setActiveRegionOverlay); only
  // meaningful while localSkyMode is active, since the polygon is stored in Alt/Az.
  private activeRegionOverlay: {
    color: string;
    points: { azDeg: number; altDeg: number }[];
  } | null = null;

  // Spatial indexes for fast hover detection
  private starIndex = new SpatialIndex<Star>(0.02);
  private dsoIndex = new SpatialIndex<DSO>(0.02);
  private starIndexMaxMag = -1;
  private dsoIndexMaxMag = -99999; // Sentinel value meaning "not initialized"

  // All DSOs indexed by projection position (no mag/filter), for viewport culling in
  // selectRenderedDSOs. Positions change only with the projection generation, so this
  // is rebuilt once per hemisphere/mode change (or DSO coordinate override), not per frame.
  private dsoAllIndex = new SpatialIndex<DSO>(0.02);
  private dsoGiants: DSO[] = []; // bodies larger than the query margin; always considered
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
    this.dsoIndexMaxMag = -99999;
    this.requestRender();
  }
  setHighlightedStar(hip: number | null) {
    this.highlightedStar = hip;
    this.starIndexMaxMag = -1;
    this.requestRender();
  }
  setVisibleDSOTypes(types: Set<string>) {
    this.visibleDSOTypes = types;
    this.dsoIndexMaxMag = -99999;
    this.requestRender();
  }
  setVisibleDSOCatalogs(catalogs: Set<string>) {
    this.visibleDSOCatalogs = catalogs;
    this.dsoIndexMaxMag = -99999;
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

  /** Replace the interactive frame instances and re-render. */
  setFovInstances(frames: RenderableFrame[]) {
    this.fovInstances = frames;
    this.requestRender();
  }
  /** Current interactive frame instances (for save/restore around off-screen renders). */
  getFovInstances(): RenderableFrame[] {
    return this.fovInstances;
  }
  setOnFovInstanceSelect(cb: (id: string | null) => void) {
    this.onFovInstanceSelect = cb;
  }
  setOnFovInstanceChange(cb: (id: string, change: FovFrameChange) => void) {
    this.onFovInstanceChange = cb;
  }
  setOnFovFrameResize(cb: (id: string, region: FovFrameResizeRegion) => void) {
    this.onFovFrameResize = cb;
  }
  setOnMosaicTileRemove(cb: (tileId: string) => void) {
    this.onMosaicTileRemove = cb;
  }
  setOnMosaicTileAdd(cb: (ra: number, dec: number) => void) {
    this.onMosaicTileAdd = cb;
  }
  setMosaicAddCandidates(c: Array<{ ra: number; dec: number }>) {
    this.mosaicAddCandidates = c;
    this.requestRender();
  }
  setOnFrameMerge(cb: (movedId: string, targetId: string) => void) {
    this.onFrameMerge = cb;
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
      this.view.scale = (Math.min(this.view.width, this.view.height) / 2) * 0.9;
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

  getShowGrid() {
    return this.showGrid;
  }

  /**
   * Shared budget context for the area-weighted star gate (see {@link renderStars} and
   * {@link starFaintLimitAt}). `count` is the pan-invariant global eligible count; the
   * per-star limit then scales it by the local projection area factor so on-screen star
   * density is uniform despite the stereographic projection's area distortion.
   */
  private starAreaBudget(): {
    mags: number[];
    count: number;
    aNorm: number;
    edgeMag: number;
  } {
    const { scale, width, height } = this.view;
    const mags = getStarMagsSorted();
    // Upper bound is the catalog length, not an artificial cap: on-screen count is
    // already bounded by the field of view, so when zoomed in the magnitude gate
    // (not a count cap) decides how faint we go.
    const budget = this.lod.effectiveStarBudget(this.maxStarCount);
    const count = targetRenderCount(
      budget,
      scale,
      width,
      height,
      STAR_DENSITY_K,
      budget * MIN_BUDGET_MULT,
      mags.length,
    );
    const aNorm = areaNormForBorderRadius(borderRadiusPU(this.borderLatDeg));
    // Faintest limit anywhere on the map: at the rim the local area factor equals aNorm²
    // so the local count is count·aNorm. Used as a cheap pre-filter before projecting, and
    // as the single atlas/paint maxMag so edge-fill stars share sprites and don't fade.
    // NOTE: no separate zoom/faintness cap (computeMaxMag) is applied. A single magnitude
    // cap applied uniformly would clamp the edge — which needs *fainter* stars than the
    // centre to reach the same on-screen density — long before the centre, so raising the
    // density budget would pile new stars into the centre and never fill the edge
    // ("outside-in", not uniform). The area-weighted count IS the cap, and it already
    // scales with zoom because count ∝ scale² (targetRenderCount).
    const edgeMag = magThresholdForCount(mags, Math.round(count * aNorm));
    return { mags, count, aNorm, edgeMag };
  }

  /**
   * Per-position faint magnitude limit for the area-weighted star gate: brighter (fewer
   * stars) near the map centre, fainter (more) toward the edge, so on-screen star density
   * stays uniform under the non-equal-area stereographic projection — at every density
   * level. Floored at STAR_BRIGHT_FLOOR_MAG so the brightest anchor stars always render.
   */
  private starFaintLimitAt(
    px: number,
    py: number,
    b: { mags: number[]; count: number; aNorm: number },
  ): number {
    const A = projectionAreaFactor(px, py);
    const localCount = Math.round(areaWeightedBudget(b.count, A, b.aNorm));
    return Math.max(magThresholdForCount(b.mags, localCount), STAR_BRIGHT_FLOOR_MAG);
  }

  /**
   * Position-independent star magnitude limit (the un-weighted budget threshold). Used
   * where a single scalar is enough — star-label gating. The precise per-position gate
   * the render loop applies is {@link starFaintLimitAt}.
   */
  private starMagThreshold(): number {
    const { mags, count } = this.starAreaBudget();
    return Math.max(magThresholdForCount(mags, count), STAR_BRIGHT_FLOOR_MAG);
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
  enterRegionDrawMode(
    onComplete: (points: { azDeg: number; altDeg: number }[]) => void,
    onCancel: () => void,
  ): boolean {
    if (!this.computeHorizonParams()) return false;
    this.regionDrawPrevLocalSkyMode = this.localSkyMode;
    if (!this.localSkyMode) this.setLocalSkyMode(true);
    this.regionDrawActive = true;
    this.regionDrawing = false;
    this.regionDrawPoints = [];
    this.onRegionDrawComplete = onComplete;
    this.onRegionDrawCancel = onCancel;
    this.canvas.style.cursor = 'crosshair';
    this.dismissTooltip();
    return true;
  }

  /** Cancels an in-progress region drawing gesture (e.g. a "Cancel" button). */
  cancelRegionDrawMode(): void {
    if (this.regionDrawActive) this.finishRegionDraw(true);
  }

  private finishRegionDraw(cancelled: boolean): void {
    const points = this.regionDrawPoints;
    const onComplete = this.onRegionDrawComplete;
    const onCancel = this.onRegionDrawCancel;
    this.regionDrawActive = false;
    this.regionDrawing = false;
    this.regionDrawPoints = [];
    this.onRegionDrawComplete = null;
    this.onRegionDrawCancel = null;
    this.canvas.style.cursor = 'default';
    if (!this.regionDrawPrevLocalSkyMode) this.setLocalSkyMode(false);
    if (cancelled || points.length < 3) onCancel?.();
    else onComplete?.(points);
    this.requestRender();
  }

  private pushRegionDrawPoint(mx: number, my: number): void {
    const hp = this.computeHorizonParams();
    if (!hp) return;
    const proj = fromCanvas(mx, my, this.view);
    const { ra, dec } = unproject(proj.x, proj.y);
    const { altDeg, azDeg } = altAzFromRaDec(ra, dec, hp.lstH, hp.latDeg);
    const last = this.regionDrawPoints[this.regionDrawPoints.length - 1];
    // Dedupe near-identical consecutive points so the saved polygon stays lean.
    if (last && Math.abs(azDeg - last.azDeg) < 0.3 && Math.abs(altDeg - last.altDeg) < 0.3) return;
    this.regionDrawPoints.push({ azDeg, altDeg });
  }

  /** Shows a saved region on the map for reference; pass null to clear it. Requires
   * Local Sky mode to render meaningfully (the polygon is stored in Alt/Az). */
  setActiveRegionOverlay(
    region: { color: string; points: { azDeg: number; altDeg: number }[] } | null,
  ): void {
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

  private addEvent(
    target: EventTarget,
    event: string,
    handler: EventListener,
    options?: AddEventListenerOptions,
  ) {
    target.addEventListener(event, handler, options);
    this.boundHandlers.push({ target, event, handler });
  }

  private setupEvents() {
    // Zoom with mouse wheel
    this.addEvent(
      this.canvas,
      'wheel',
      ((e: WheelEvent) => {
        e.preventDefault();
        this.cancelAnimation();
        // A wheel gesture takes over from hovering: hide any tooltip so it doesn't
        // linger over the moving map while the user zooms.
        this.dismissTooltip();
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        // Keep the projection point under the cursor anchored across the zoom.
        const z = zoomAboutPoint(this.view, mx, my, factor, 50, 1000000);
        this.view.scale = z.scale;
        this.view.centerX = z.centerX;
        this.view.centerY = z.centerY;

        this.onViewChange?.();
        this.requestRenderInteractive();
      }) as EventListener,
      { passive: false },
    );

    // Pan with mouse drag
    this.addEvent(this.canvas, 'mousedown', ((e: MouseEvent) => {
      this.cancelAnimation();
      if (e.button === 0) {
        if (this.regionDrawActive) {
          this.regionDrawing = true;
          this.regionDrawPoints = [];
          const rect = this.canvas.getBoundingClientRect();
          this.pushRegionDrawPoint(e.clientX - rect.left, e.clientY - rect.top);
          this.requestRenderInteractive();
          return; // region drawing consumed the press — no pan
        }
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
      if (this.regionDrawActive) {
        // Suppress hover/tooltips for the whole gesture (not just while dragging) —
        // a star/DSO tooltip popping up under the crosshair gets in the way of drawing.
        this.dismissTooltip();
        if (this.regionDrawing) {
          const rect = this.canvas.getBoundingClientRect();
          this.pushRegionDrawPoint(e.clientX - rect.left, e.clientY - rect.top);
          this.requestRenderInteractive();
        }
        return;
      }
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
        const isOverPanel =
          sidePanel &&
          !sidePanel.classList.contains('collapsed') &&
          e.clientX > window.innerWidth - 280; // Panel is 280px wide on the right

        const inSky = !isOverPanel && isInsideBorderCircle(mx, my, this.view, this.borderLatDeg);
        if (inSky) {
          this.requestHover(mx, my, e.clientX, e.clientY);
        } else {
          // Cursor is over the side panel or outside the visible sky circle (in the
          // black corners beyond the rim). Dismiss any tooltip so it never lingers or
          // fires out there — the render loop clips objects to this same circle, so a
          // rectangular hover gate would tooltip objects the user cannot see.
          this.dismissTooltip();
        }
      }
    }) as EventListener);

    this.addEvent(window, 'mouseup', ((e: MouseEvent) => {
      if (this.regionDrawActive) {
        this.finishRegionDraw(!this.regionDrawing);
        return;
      }
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
      if (this.regionDrawActive) {
        this.finishRegionDraw(true);
      } else if (this.pickingMode) {
        this.exitPickingMode();
      } else if (this.fovInstances.some((f) => f.active)) {
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
    this.hoverAnchor = null;
    this.onStarHover?.(null, 0, 0);
    this.onDSOHover?.(null, 0, 0);
  }

  private findClosestDSO(mx: number, my: number): DSO | null {
    if (!this.showDSOs) return null;
    // DSOs are gated by priority (not magnitude), so the hit-test index must include all
    // catalog DSOs — a superset of what is drawn; isDSORendered does the precise gating.
    this.buildDSOIndex(null);
    const projPt = fromCanvas(mx, my, this.view);

    // Generous threshold collects all nearby DSO centres: large DSOs (e.g. M42 at 90')
    // have centres far from the cursor even when it sits inside their rendered ellipse.
    const generousThreshold = 200 / this.view.scale;
    const candidates = this.dsoIndex.findAll(projPt.x, projPt.y, generousThreshold);
    return pickDsoAtCursor(candidates, mx, my, this.view);
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
    const candidates = this.dsoIndex.findAll(
      projCenter.x,
      projCenter.y,
      radiusPx / this.view.scale,
    );

    const inside: Array<{ dso: DSO; dist: number }> = [];
    for (const dso of candidates) {
      const p = project(dso.ra, dso.dec);
      const c = toCanvas(p.x, p.y, this.view);
      if (pointInConvexPolygon(c.x, c.y, corners)) {
        inside.push({ dso, dist: Math.hypot(c.x - cx, c.y - cy) });
      }
    }
    inside.sort((a, b) => a.dist - b.dist);
    return inside.map((e) => e.dso);
  }

  /**
   * Check if a star would actually be rendered given current viewport and limits.
   * Replicates the filtering logic from renderStars().
   */
  private isStarRendered(star: Star): boolean {
    const { view } = this;
    const p = project(star.ra, star.dec);

    // Same area-weighted per-position magnitude gate as renderStars (highlighted star
    // always shows), so hover/click matches exactly what is drawn.
    if (
      star.hip !== this.highlightedStar &&
      star.mag > this.starFaintLimitAt(p.x, p.y, this.starAreaBudget())
    ) {
      return false;
    }

    // Check viewport bounds
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
    const summits = this.mountainProfile?.summits;
    if (!this.showMountainHorizon || !summits?.length) return null;
    const hp = this.computeHorizonParams();
    if (!hp) return null;
    const projPt = fromCanvas(mx, my, this.view);
    const threshold = 12 / this.view.scale; // ~12 px
    let best: { summit: HorizonSummit; dist: number } | null = null;
    for (const s of summits) {
      const { raDeg, decDeg } = raDecFromAltAz(s.altDeg, s.azDeg, hp.lstH, hp.latDeg);
      const p = project(raDeg, decDeg);
      if (p.x >= 1e5) continue;
      const dist = Math.hypot(p.x - projPt.x, p.y - projPt.y);
      if (dist <= threshold && (!best || dist < best.dist)) best = { summit: s, dist };
    }
    return best;
  }

  private handleHover(mx: number, my: number, clientX: number, clientY: number) {
    const closestSummit = this.findClosestSummit(mx, my);
    const closestStar = this.findClosestStar(mx, my);
    const closestDSO = this.findClosestDSO(mx, my);

    // Verify that found objects would actually be rendered (not hidden by count limits)
    const starRendered = closestStar ? this.isStarRendered(closestStar) : false;
    const dsoRendered = closestDSO ? this.isDSORendered(closestDSO) : false;

    this.hoveredDSO = closestDSO && dsoRendered ? closestDSO : null;

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

    // A summit dot wins when it is the nearest thing under the cursor (they sit on
    // the horizon where stars/DSOs are sparse, but a genuinely closer star still wins).
    const summitDist = closestSummit ? closestSummit.dist : Infinity;

    // Show tooltip for the closest rendered object
    if (closestSummit && summitDist <= starDist && summitDist <= dsoDist) {
      this.onSummitHover?.(closestSummit.summit, clientX, clientY);
      this.hoverAnchor = { mx, my, simMs: this.simDate.getTime() };
    } else if (starRendered && dsoRendered) {
      // Both found and rendered - show the closest one
      if (starDist < dsoDist) {
        this.onStarHover?.(closestStar, clientX, clientY);
      } else {
        this.onDSOHover?.(closestDSO, clientX, clientY);
      }
      this.hoverAnchor = { mx, my, simMs: this.simDate.getTime() };
    } else if (dsoRendered) {
      this.onDSOHover?.(closestDSO, clientX, clientY);
      this.hoverAnchor = { mx, my, simMs: this.simDate.getTime() };
    } else if (starRendered) {
      this.onStarHover?.(closestStar, clientX, clientY);
      this.hoverAnchor = { mx, my, simMs: this.simDate.getTime() };
    } else {
      // No rendered object under the cursor. Normally this dismisses the tooltip, but
      // while the clock is running the object may simply have drifted away from a
      // still cursor (the whole sky rotates as simDate advances). In that case a tiny
      // mousemove/jitter must NOT dismiss it — only a deliberate move does. So keep the
      // tooltip when the sky has advanced since it was shown AND the cursor is still
      // within jitter range of the anchor; dismiss otherwise.
      const a = this.hoverAnchor;
      const skyMoved = a !== null && this.simDate.getTime() !== a.simMs;
      const cursorStill =
        a !== null && Math.hypot(mx - a.mx, my - a.my) <= SkyMap.HOVER_DRIFT_GRACE_PX;
      if (skyMoved && cursorStill) {
        // Refresh the anchor to this frame's position/time instead of leaving it
        // pinned to the original find. Otherwise the grace radius is a *cumulative*
        // budget spent across the whole hold (every real mouse has some tremor), so a
        // long hold during a fast clock eventually exceeds it and the tooltip drops —
        // even though the cursor barely moved on any single frame. Refreshing makes it
        // a per-frame tolerance instead, so a genuinely still cursor holds indefinitely.
        this.hoverAnchor = { mx, my, simMs: this.simDate.getTime() };
        return;
      }
      this.hoverAnchor = null;
      this.onStarHover?.(null, clientX, clientY);
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
    this.cachedSelectedDSOs = null;
    this.cachedSelectedDSOIds = null;

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
      if (this.fovInstances.length > 0) {
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
    const hasFrames = this.fovFrameSpecs.length > 0 || this.fovInstances.length > 0;
    const hasRegionDraw = this.regionDrawActive && this.regionDrawPoints.length > 0;
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
    if (this.fovInstances.length > 0) this.renderFovInstances();
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
    if (!hp || this.regionDrawPoints.length === 0) return;
    const { view } = this;
    ctx.save();
    ctx.beginPath();
    this.regionDrawPoints.forEach((p, i) => {
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

  // ── Interactive frame instances ────────────────────────────────────────────

  // ── Frame canvas geometry ────────────────────────────────────────────────
  // The maths lives in ./frame-geometry (pure, unit-tested); these thin wrappers
  // bind the live `this.view` so the many call sites below stay unchanged.
  private frameAnchorCanvas(f: RenderableFrame): { cx: number; cy: number } {
    return frameAnchorCanvas(f, this.view);
  }
  private canvasRotDegToPa(rotDeg: number, raDeg: number, decDeg: number): number {
    return canvasRotDegToPa(rotDeg, raDeg, decDeg, this.view);
  }
  private frameCanvasRotationDeg(f: RenderableFrame): number {
    return frameCanvasRotationDeg(f, this.view);
  }
  private frameGeometry(f: RenderableFrame): FrameGeometry {
    return frameGeometry(f, this.view);
  }
  private mosaicOutlinePath(f: RenderableFrame): Point[] | null {
    return mosaicOutlinePath(f, this.view);
  }
  private frameHandlesVisible(halfW: number, halfH: number): boolean {
    return frameHandlesVisible(halfW, halfH);
  }

  private renderFovInstances() {
    const { ctx } = this;
    const cs = getComputedStyle(this.canvas);
    const strokeColor = cs.getPropertyValue('--fov-frame-stroke').trim() || FRAME.strokeFallback;
    const labelColor = cs.getPropertyValue('--fov-frame-label').trim() || FRAME.labelFallback;
    const activeColor = cs.getPropertyValue('--accent-color').trim() || labelColor;
    const dangerColor = cs.getPropertyValue('--color-danger').trim() || FRAME.dangerFallback;
    // The selected mosaic's tiles each get a delete button (per-tile editing).
    const activeMosaicId = this.fovInstances
      .find((f) => f.active && f.isMosaicOutline)
      ?.id.split(':')[2];

    for (const f of this.fovInstances) {
      if (f.visible === false) continue; // hidden via the manager checkbox
      // Off-projection (below the Local Sky horizon, or the far hemisphere in fisheye):
      // project() returns a sentinel there, so the frame would be painted far off-canvas
      // with zero extents and degenerate handles. Skip it outright.
      if (f.anchorKind === 'sky' && !isSkyPointVisible(f.ra ?? 0, f.dec ?? 0)) continue;
      const { corners, cx, cy, rotDeg, halfW, halfH } = this.frameGeometry(f);
      const isActive = f.active;
      const isTile = !!f.mosaicId; // a faint mosaic panel (the outline frame draws the rest)

      ctx.save();
      ctx.globalAlpha = isTile ? 0.4 : isActive ? 1 : 0.5;
      ctx.strokeStyle = isActive && !isTile ? activeColor : strokeColor;
      ctx.lineWidth = isActive && !isTile ? FRAME.lineWidthActive : FRAME.lineWidth;
      ctx.setLineDash(FRAME.dashOutline);
      // A mosaic outline traces its tile perimeter (follows projection curvature);
      // every other frame is its 4-corner rectangle.
      const outline = f.isMosaicOutline ? (this.mosaicOutlinePath(f) ?? corners) : corners;
      drawFramePolyline(ctx, outline);

      if (isTile) {
        // Border tiles of the selected mosaic carry a delete button (large tiles only).
        if (
          f.mosaicId === activeMosaicId &&
          f.mosaicIsBorderTile &&
          this.tileTrashVisible(halfW, halfH)
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
      if (isActive && this.frameHandlesVisible(halfW, halfH)) {
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
          this.framePinGlyphPos(corners[1], rotDeg),
        );
      }
      ctx.restore();
    }

    // Rubber-band preview of a drag-to-extend in progress.
    if (this.resizeDraft) {
      const d = this.resizeDraft;
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
    if (this.snapCandidate && this.frameDrag?.mode === 'move') {
      const f = this.fovInstances.find((x) => x.id === this.frameDrag!.id);
      if (f) {
        const snap = this.snapCandidate;
        const { cx, cy } = this.frameAnchorCanvas(f);
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
      this.mosaicAddCandidates.length &&
      this.mosaicEditButtonsVisible(activeMosaicId)
    ) {
      const avoid = this.activeOutlineRotateAvoid();
      for (const c of this.mosaicAddCandidates)
        drawTileAdd(ctx, this.candidateCanvasPoint(c, avoid), activeColor);
    }
  }

  /** Pin glyph position: the top-right corner lifted outward (local "up") so the
   * icon sits just above the frame with a small margin. */
  private framePinGlyphPos(corner: Point, rotDeg: number): Point {
    return framePinGlyphPos(corner, rotDeg);
  }

  /** Whether a tile is large enough to host its delete/add button. */
  private tileTrashVisible(halfW: number, halfH: number): boolean {
    return Math.min(halfW, halfH) >= 16; // only on tiles big enough that the icon fits
  }

  /** Whether the selected mosaic's tiles are large enough to host their edit
   * buttons (delete / add), and the canvas point of an add candidate. */
  private mosaicEditButtonsVisible(mosaicId: string): boolean {
    const t = this.fovInstances.find((f) => f.mosaicId === mosaicId);
    if (!t) return false;
    const g = this.frameGeometry(t);
    return this.tileTrashVisible(g.halfW, g.halfH);
  }

  /** The selected mosaic outline's rotate-handle position + centre, so add ("+")
   * buttons can be nudged clear of the rotation needle. Null when not applicable. */
  private activeOutlineRotateAvoid(): { handle: Point; center: Point } | null {
    const outline = this.fovInstances.find((f) => f.active && f.isMosaicOutline);
    if (!outline) return null;
    const geo = this.frameGeometry(outline);
    if (!this.frameHandlesVisible(geo.halfW, geo.halfH)) return null;
    return {
      handle: rotateHandlePos(geo.cx, geo.cy, geo.halfH, geo.rotDeg, 24),
      center: { x: geo.cx, y: geo.cy },
    };
  }

  /** Canvas point of an add candidate. If it would sit on the rotate needle, push
   * it outward (away from the mosaic centre) past the handle so it stays clickable. */
  private candidateCanvasPoint(
    c: { ra: number; dec: number },
    avoid?: { handle: Point; center: Point } | null,
  ): Point {
    const p = project(c.ra, c.dec);
    let pt = toCanvas(p.x, p.y, this.view);
    if (avoid && Math.hypot(pt.x - avoid.handle.x, pt.y - avoid.handle.y) < TILE_TRASH_R * 2 + 4) {
      const dx = pt.x - avoid.center.x,
        dy = pt.y - avoid.center.y;
      const len = Math.hypot(dx, dy) || 1;
      const newDist =
        Math.hypot(avoid.handle.x - avoid.center.x, avoid.handle.y - avoid.center.y) +
        TILE_TRASH_R +
        14;
      pt = { x: avoid.center.x + (dx / len) * newDist, y: avoid.center.y + (dy / len) * newDist };
    }
    return pt;
  }

  /** Hit-test the active/instance frames on mousedown. Returns true if the event was consumed (no pan). */
  private handleFrameMouseDown(mx: number, my: number): boolean {
    if (!this.interactionEnabled || this.pickingMode || this.fovInstances.length === 0)
      return false;

    const active = this.fovInstances.find((f) => f.active);
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
          if (isNearHandle(mx, my, pinPos, 10)) {
            this.toggleFramePin(active);
            return true;
          }
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
            if (isNearHandle(mx, my, this.candidateCanvasPoint(c, avoid), TILE_TRASH_R)) {
              this.onMosaicTileAdd?.(c.ra, c.dec);
              return true;
            }
          }
          for (const t of this.fovInstances) {
            if (t.mosaicId !== mosaicId || !t.mosaicIsBorderTile) continue;
            const tg = this.frameGeometry(t);
            if (isNearHandle(mx, my, { x: tg.cx, y: tg.cy }, TILE_TRASH_R)) {
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
    const f = this.fovInstances.find((x) => x.id === id);
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
    const active = this.fovInstances.find((f) => f.active);
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
      ra = near.ra;
      dec = near.dec;
      dsoId = near.id;
    } else {
      const proj = fromCanvas(cx, cy, this.view);
      const u = unproject(proj.x, proj.y);
      ra = u.ra;
      dec = u.dec;
      dsoId = null;
      // A plan frame placed freely takes the DSO nearest its centre that falls
      // inside it (custom location if none).
      if (f.derivesTargetFromContent) {
        const moved: RenderableFrame = { ...f, anchorKind: 'sky', ra, dec };
        dsoId = frameTargetDso(this.dsosInFrame(moved).map((d) => d.id));
      }
    }
    const paDeg = this.canvasRotDegToPa(canvasRotDeg, ra, dec);
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
    const f = this.fovInstances.find((x) => x.id === id);
    if (!f || !f.pinnable || f.anchorKind !== 'sky') return;
    const { cx, cy } = this.frameAnchorCanvas(f);
    const near = this.findClosestDSO(cx, cy);
    if (!near) return;
    // Keep the frame's on-screen orientation across the re-anchor by recomputing
    // the PA at the snapped object's RA.
    const canvasRotDeg = this.frameCanvasRotationDeg(f);
    const paDeg = this.canvasRotDegToPa(canvasRotDeg, near.ra, near.dec);
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
    const f = this.fovInstances.find((x) => x.id === id);
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
      const paDeg = this.canvasRotDegToPa(canvasRotDeg, ra, dec);
      const done = t >= 1;
      // Keep the DSO target bound for every frame of the spring (it's known the
      // whole time); a null mid-flight would flip a mosaic's name to the gear spec.
      this.onFovInstanceChange?.(id, {
        anchor: {
          kind: 'sky',
          ra: done ? snap.ra : ra,
          dec: done ? snap.dec : dec,
          dsoId: snap.id,
        },
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
    const f = this.fovInstances.find((x) => x.id === id);
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
    const f = this.fovInstances.find((x) => x.id === this.frameDrag!.id);
    if (!f) {
      this.frameDrag = null;
      return;
    }

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
        const c = clampSmartMosaicSize(
          reqWDeg,
          reqHDeg,
          f.smartMosaic.nativeWDeg,
          f.smartMosaic.nativeHDeg,
          f.smartMosaic.env,
        );
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
        const pa = this.canvasRotDegToPa(rotDeg, f.ra ?? 0, f.dec ?? 0);
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
        const ra = u.ra,
          dec = u.dec;
        let dsoId: string | null = null;
        const near = f.anchorSnap !== false ? this.findClosestDSO(mx, my) : null;
        // Recompute the PA so the frame keeps the same on-screen angle at the
        // new position.
        const paDeg = this.canvasRotDegToPa(canvasRotDeg, ra, dec);
        if (near) {
          this.snapCandidate = {
            id: near.id,
            ra: near.ra,
            dec: near.dec,
            majAxis: near.majAxis ?? 1,
          };
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
            dsoId = frameTargetDso(this.dsosInFrame(moved).map((d) => d.id));
          }
        }
        // Emitting the change drives the re-render (via the store watch →
        // setFovInstances), which redraws the elastic from the frame's updated
        // centre. No explicit render() here — a synchronous one would paint the
        // line from the frame's stale (pre-change) position and flicker.
        this.onFovInstanceChange?.(f.id, { anchor: { kind: 'sky', ra, dec, dsoId }, paDeg });
      } else {
        this.onFovInstanceChange?.(f.id, {
          anchor: { kind: 'screen', nx: mx / this.view.width, ny: my / this.view.height },
        });
      }
    }
  }

  /** After moving a standalone plan frame, merge it if it now overlaps another
   * frame or a mosaic of the same plan (emits the merge for the store to apply). */
  private checkFrameMerge(movedId: string): void {
    if (!this.onFrameMerge) return;
    const targetId = findMergeTarget(movedId, this.fovInstances, this.view);
    if (targetId) this.onFrameMerge(movedId, targetId);
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
    const f = draft ? this.fovInstances.find((x) => x.id === frameId) : undefined;
    if (!draft || !f) {
      this.render();
      return;
    }
    const region = resizeRegionFromDraft(f, draft, this.view, fromCanvas, unproject);
    this.render();
    this.onFovFrameResize?.(f.id, region);
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
      if (!isHighlighted && star.mag > this.starFaintLimitAt(star._px!, star._py!, sb)) {
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
      const body = near ? (((dso.majAxis ?? 1) / 2 / 60) * DEG2RAD) / (2 * dsoSizeCos2(dso)) : 0;
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

    // In zenith ("local sky") mode, DSO angular size must scale with altitude (the
    // projection's pole), not dec — see dsoSizeCos2. isBelowHorizonCached also
    // stamps _altDeg as a side effect, so this doubles as the altitude source.
    const horizon = this.localSkyMode ? this.computeHorizonParams() : null;
    const dsoAltDeg = (d: DSO): number | undefined => {
      if (!horizon) return undefined;
      isBelowHorizonCached(d, horizon.lstH, horizon.latDeg);
      return d._altDeg;
    };

    // Viewport cull: query the position index for DSOs whose centre is within the
    // visible disc plus a margin for the largest body and the off-screen render margin.
    // This replaces a full scan of all ~12k DSOs every frame with a bounded query — a big
    // win when zoomed in (small viewport).
    this.ensureDsoAllIndex();
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
      Math.hypot(view.centerX, view.centerY) +
      borderRadiusPU(this.borderLatDeg + 2) +
      this.dsoMaxBodyPU;
    const queryR = Math.min(
      Math.hypot(view.width / 2, view.height / 2) / view.scale +
        this.dsoMaxBodyPU +
        20 / view.scale,
      capR,
    );
    const nearby = this.dsoAllIndex.collect(view.centerX, view.centerY, queryR);

    // Area-normalisation for the area-weighted gate below (see render-budget.ts): the mean
    // projection area factor over the visible cap, so weighting compensates the projection
    // (thinner centre, denser edge) without changing the overall count.
    const aNorm = areaNormForBorderRadius(borderRadiusPU(this.borderLatDeg));
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
    for (const src of [nearby, this.dsoGiants])
      for (const dso of src) {
        const isHighlighted = this.highlightedDSO === dso.id;

        if (!isHighlighted) {
          if (!this.visibleDSOTypes.has(dso.type)) continue;
          const cat = dso.catalog;
          if (cat && !this.visibleDSOCatalogs.has(cat)) continue;
          if (this.localSkyMode) {
            // Below-horizon DSOs are already hidden by the horizon-circle canvas
            // clip; this just skips the size/bbox work for them earlier.
            if (horizon && isBelowHorizonCached(dso, horizon.lstH, horizon.latDeg)) continue;
          } else if (!this.fisheyeMode) {
            // Dec pre-filter: skip objects clearly outside the border (stereo only
            // — in fisheye the far hemisphere is clipped by project() returning
            // off-canvas).
            if (this.hemisphere === 'north' && dso.dec < -(this.borderLatDeg + 2)) continue;
            if (this.hemisphere === 'south' && dso.dec > +(this.borderLatDeg + 2)) continue;
          }
          // Container gate: hide an inner object until its container renders large
          // enough on screen (so the container stays clean and clickable when zoomed out).
          if (dso.containerId && dso.containerId !== this.highlightedDSO) {
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

    const selected = selectDSOsToRender(candidates, this.dsoPriorityThreshold()).map((s) => s.dso);
    this.cachedSelectedDSOs = selected;
    this.cachedSelectedDSOIds = new Set(selected.map((d) => d.id));
    return selected;
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
