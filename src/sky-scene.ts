/**
 * The per-frame render context ("scene") shared by the sky-map draw passes.
 *
 * Before this existed, every `render*` method read ~40 fields straight off the
 * `SkyMap` instance, and the off-screen export path had to temporarily *mutate*
 * `this.ctx`, `this.view` and the layer flags (restoring them in a `finally`) to
 * redirect a render. Making the dependencies an explicit value means an export is
 * just a different scene, so the live map's state is never touched.
 *
 * A scene is built once per render pass and thrown away.
 */
import type { DSO, ViewState } from './types';
import type { HorizonParams, AltAzPoint, FovFrameSpec } from './sky-map-types';
import type { PhotoOutline } from './photo-outline';
import type { HorizonProfile } from './horizon-io';
import type { SkyThemeConfig } from './sky-themes';
import type { StarAreaBudget } from './star-budget';
import type { StarSpriteAtlas } from './star-sprite-atlas';
import type { FrameController } from './frame-controller';
import type { Trajectory } from './sky-trajectory';

/** Layers that the export path can override per render. */
export interface SkyLayerFlags {
  showStars: boolean;
  showDSOs: boolean;
  showConstellationLines: boolean;
  showConstellationNames: boolean;
  showGrid: boolean;
  showStarLabels: boolean;
  showDSOLabels: boolean;
}

export interface SkyScene extends SkyLayerFlags {
  ctx: CanvasRenderingContext2D;
  view: ViewState;
  theme: SkyThemeConfig;
  /** Observer params for this frame — null outside date mode or with no location. */
  horizon: HorizonParams | null;
  /**
   * True while rendering to an off-screen target (the export path). Frames and the
   * terrain mass are drawn inline rather than onto the overlay canvas, which does
   * not exist for an off-screen render.
   */
  offscreen: boolean;

  // ── Projection / view mode ────────────────────────────────────────────────
  hemisphere: 'north' | 'south';
  borderLatDeg: number;
  localSkyMode: boolean;
  fisheyeMode: boolean;

  // ── Opacity ───────────────────────────────────────────────────────────────
  skyOpacity: number;
  backgroundOpacity: number;
  /** Below-horizon objects are dimmed (not hidden) to this alpha, in date mode only. */
  belowHorizonAlpha: number;

  // ── Date-mode overlays ────────────────────────────────────────────────────
  skyTimeMode: 'live' | 'date';
  simDate: Date;
  showMoon: boolean;
  showSun: boolean;
  showPlanets: boolean;
  showAzimuthGrid: boolean;
  /** The selected object's night path — Local Sky only (see sky-trajectory.ts). */
  showTrajectory: boolean;
  showMountainHorizon: boolean;
  showCardinalPoints: boolean;
  mountainProfile: HorizonProfile | null;

  // ── Selection / highlight ─────────────────────────────────────────────────
  highlightedStar: number | null;
  highlightedDSO: string | null;
  /**
   * The highlighted object's sampled night arc, resolved in buildScene() — null
   * unless the trajectory overlay is on, Local Sky is active and something is
   * selected. Precomputed here (behind a memo) so the draw pass stays pure.
   */
  trajectory: Trajectory | null;

  // ── Stars ─────────────────────────────────────────────────────────────────
  starBudget: StarAreaBudget;
  atlas: StarSpriteAtlas;
  /** Whether a gesture is in flight — freezes the sprite atlas. */
  interacting: boolean;

  // ── DSOs ──────────────────────────────────────────────────────────────────
  /** The DSOs to draw this frame (shape pass, label pass and hit-testing agree). */
  selectedDSOs: () => DSO[];

  // ── Overlays ──────────────────────────────────────────────────────────────
  showPhotoOutlines: boolean;
  photoOutlines: PhotoOutline[];
  fovFrameSpecs: FovFrameSpec[];
  fovRotationDeg: number;
  frames: FrameController;
  regionDrawPoints: readonly AltAzPoint[];
  regionDrawActive: boolean;
  activeRegionOverlay: { color: string; points: AltAzPoint[] } | null;

  /** Resolves a CSS custom property against the live canvas (canvas has no CSS vars). */
  cssVar: (name: string, fallback: string) => string;
}
