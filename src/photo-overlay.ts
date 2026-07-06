import type {
  Photo,
  PhotoCorrespondence,
  Star,
  Point,
  ViewState,
  ManualPlacement,
  ApiErrorDetails,
  PhotoIntegration,
  PointOfInterest,
  PoiCategory,
  AffineMatrix,
} from './types';
import {
  project,
  toCanvas,
  fromCanvas,
  unproject,
  borderRadiusPU,
  getProjectionGeneration,
} from './projection';
import { reportUnknownRendererError } from './error-reporter';
import { affineToCSS } from './affine';
import {
  fitPhotoAffine,
  buildPhotoPoints,
  projCentroidAndHalfDiag,
  isCentroidInsideBorder,
  isCentroidViewportCulled,
  computePhotoQuadCorners,
  computePhotoMatrixForView,
  computePhotoCenterAndScale,
  computePhotoCenter,
  isLabelAllowed as labelAllowed,
  isPoiAllowed as poiAllowed,
  manualPlacementCentroid,
  computeManualMatrix,
  buildSyntheticCorrespondences,
  extractMatrixFromTransform,
  derivePlacementFromCorrespondences,
  derivePlacementFromMatrix,
} from './photo-placement';
import {
  uploadPhoto,
  deletePhotoAPI,
  solveWCS,
  submitPlateSolve,
  pollPlateSolve,
  solveWithASTAP,
  solveWithSolveField,
  searchStarsAPI,
  searchStarsByPosition,
  listAstrometrySubmissions,
  reuseAstrometrySubmission,
  updatePhotoMetadata,
  updatePhotoManualPlacement,
  loadServerSettings,
  getSolverAvailability,
} from './api';
import { searchUnified, searchDSOs } from './search';
import { showToast } from './toast';
import { getDSOById, findDSOsInImage } from './dso-catalog';
import { renderSharedSolveStatus } from './solve-status-widget';
import type { SkyMap } from './sky-map';
import { t } from './i18n';
import { stripExtension } from './file-utils';
import type { PhotoCanvasQuad } from './photo-draw-order';
import { buildIntegrationFilterField } from './chip-utils';
import trashSvg from './icons/trash.svg?raw';
import { createImageZoomPan } from './image-zoom';

/** Result of the manual star-identification sub-modal (see openManualIdentifyModal). */
export type ManualIdentifyResult =
  | { action: 'validate'; correspondences: PhotoCorrespondence[] }
  | { action: 'manual-placement' }
  | { action: 'cancel' };

const MARKER_COLORS = ['#ff4444', '#44cc44', '#4488ff'];
const DEFAULT_INTEGRATION_FILTERS = ['L', 'R', 'G', 'B', 'Ha', 'OIII', 'SII', 'RGB'];

function normalizeIntegrationFilterKey(value: string): string {
  return value.trim().toLowerCase();
}

function sanitizeIntegrationRows(rows: PhotoIntegration[]): PhotoIntegration[] {
  return rows.map((row) => ({
    frames:
      Number.isInteger(Number(row.frames)) && Number(row.frames) >= 0 ? Number(row.frames) : 0,
    seconds:
      Number.isInteger(Number(row.seconds)) && Number(row.seconds) >= 0 ? Number(row.seconds) : 0,
    filter: row.filter.trim(),
  }));
}

const ASTROMETRY_SUBMISSIONS_CACHE_TTL_MS = 2 * 60 * 1000;
let astrometrySubmissionsCache: { at: number; submissions: any[] } | null = null;
let astrometrySubmissionsInFlight: Promise<any[]> | null = null;

async function loadAstrometrySubmissionsWithCache(forceRefresh = false): Promise<any[]> {
  const now = Date.now();

  // Avoid re-querying astrometry.net if we just fetched submissions.
  if (
    !forceRefresh &&
    astrometrySubmissionsCache &&
    now - astrometrySubmissionsCache.at < ASTROMETRY_SUBMISSIONS_CACHE_TTL_MS
  ) {
    return astrometrySubmissionsCache.submissions;
  }

  if (astrometrySubmissionsInFlight) {
    return astrometrySubmissionsInFlight;
  }

  astrometrySubmissionsInFlight = (async () => {
    try {
      const submissions = await listAstrometrySubmissions();

      if (submissions.length > 0) {
        astrometrySubmissionsCache = { at: Date.now(), submissions };
        return submissions;
      }

      // If a transient API issue returns an empty list, keep showing the last known list.
      if (astrometrySubmissionsCache && astrometrySubmissionsCache.submissions.length > 0) {
        return astrometrySubmissionsCache.submissions;
      }

      return submissions;
    } catch (err) {
      if (astrometrySubmissionsCache && astrometrySubmissionsCache.submissions.length > 0) {
        return astrometrySubmissionsCache.submissions;
      }
      throw err;
    } finally {
      astrometrySubmissionsInFlight = null;
    }
  })();

  return astrometrySubmissionsInFlight;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface PlacedPhoto {
  photo: Photo;
  imgEl: HTMLImageElement;
  visible: boolean;
  opacity: number;
  pendingDelete?: boolean;
  borderHidden: boolean;
  /** True when the photo centre is outside the canvas viewport; set by updateTransforms(). */
  viewportCulled: boolean;
  /** Projection-space centroid (average of projected correspondence points), null until first render. */
  projCentroid: { x: number; y: number } | null;
  /** Max distance from centroid to any correspondence point in projection space; used for cull margin. */
  projHalfDiag: number;
  /**
   * Projection generation (see projection.ts) the cached projCentroid/projHalfDiag were
   * computed under. The centroid is only valid for the fast viewport cull while this
   * matches the current generation; a hemisphere/mode/center change bumps the generation
   * and forces a full applyTransform recompute (otherwise photos stay stuck culled).
   */
  projGen: number;
}

function starDisplayLabel(star: Star): string {
  if (star.name) {
    if (star.bayer && star.constellation) {
      return `${star.name} (${star.bayer} ${star.constellation})`;
    }
    return star.name;
  }
  if (star.desig && star.constellation) {
    return `${star.desig} ${star.constellation}`;
  }
  if (star.flam && star.constellation) {
    return `${star.flam} ${star.constellation}`;
  }
  return `HIP ${star.hip} (${star.constellation || '?'}, mag ${star.mag.toFixed(1)})`;
}

let _currentTooltipAnchor: HTMLElement | null = null;

function _dismissTooltip(anchorElement: HTMLElement): boolean {
  const existing = document.querySelector('.hints-info-tooltip');
  if (!existing) return false;
  existing.remove();
  const wasSame = _currentTooltipAnchor === anchorElement;
  _currentTooltipAnchor = null;
  return wasSame; // true = same icon clicked again (toggle → don't reopen)
}

/**
 * Show hints information tooltip near the info icon
 */
function showHintsInfoTooltip(anchorElement: HTMLElement) {
  if (_dismissTooltip(anchorElement)) return; // toggle off

  const tooltip = document.createElement('div');
  tooltip.className = 'hints-info-tooltip';

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'hints-info-close';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => tooltip.remove());
  tooltip.appendChild(closeBtn);

  // Title
  const title = document.createElement('h3');
  title.textContent = t('modal.hintsInfoTitle') || 'Automatic Solving - Help';
  tooltip.appendChild(title);

  // Intro
  const intro = document.createElement('p');
  intro.textContent =
    t('modal.hintsInfoIntro') ||
    'Automatic solving identifies stars in your photo to place it on the sky map.';
  tooltip.appendChild(intro);

  // Options section
  const optionsTitle = document.createElement('h4');
  optionsTitle.textContent = t('modal.hintsInfoOptions') || 'Available options';
  tooltip.appendChild(optionsTitle);

  const optionsList = document.createElement('ul');

  const solveFieldItem = document.createElement('li');
  solveFieldItem.innerHTML =
    t('modal.hintsInfoSolveField') ||
    '<strong>solve-field (local)</strong>: Local astrometry.net solver, accurate and private. Requires index files installation (~2.4GB). Takes 10-30 seconds.';
  optionsList.appendChild(solveFieldItem);

  const astapItem = document.createElement('li');
  astapItem.innerHTML =
    t('modal.hintsInfoASTAP') ||
    '<strong>ASTAP (local)</strong>: Fast (~3-5 seconds) but requires local installation. Works best with position hints.';
  optionsList.appendChild(astapItem);

  const onlineItem = document.createElement('li');
  onlineItem.innerHTML =
    t('modal.hintsInfoOnline') ||
    '<strong>Online (astrometry.net)</strong>: Cloud service, accurate but may take 30-60 seconds. Works for most images.';
  optionsList.appendChild(onlineItem);

  const wcsItem = document.createElement('li');
  wcsItem.innerHTML =
    t('modal.hintsInfoWCS') ||
    '<strong>Metadata (WCS)</strong>: Reads coordinates already present in FITS/TIFF files (instant).';
  optionsList.appendChild(wcsItem);

  tooltip.appendChild(optionsList);

  // Recommendations section
  const recoTitle = document.createElement('h4');
  recoTitle.textContent = t('modal.hintsInfoRecommendations') || 'Recommendations';
  tooltip.appendChild(recoTitle);

  const recoList = document.createElement('ul');

  const hintsItem = document.createElement('li');
  hintsItem.textContent =
    t('modal.hintsInfoUseHints') ||
    'For images with few bright stars (galaxies, nebulae), enter the target object name in the field above.';
  recoList.appendChild(hintsItem);

  const fovHintItem = document.createElement('li');
  fovHintItem.textContent =
    'If you know your image field of view (FOV), entering it significantly improves ASTAP solving reliability.';
  recoList.appendChild(fovHintItem);

  const minStarsItem = document.createElement('li');
  minStarsItem.textContent =
    t('modal.hintsInfoMinStars') ||
    'ASTAP requires ~100-300 detectable stars in the image (magnitude up to 16).';
  recoList.appendChild(minStarsItem);

  const fovItem = document.createElement('li');
  fovItem.textContent =
    t('modal.hintsInfoFOV') || 'Works best for fields 0.5° to 10° (most amateur photos).';
  recoList.appendChild(fovItem);

  tooltip.appendChild(recoList);

  // Troubleshooting section
  const troubleTitle = document.createElement('h4');
  troubleTitle.textContent = t('modal.hintsInfoTroubleshooting') || 'If solving fails';
  tooltip.appendChild(troubleTitle);

  const troubleList = document.createElement('ul');

  const tryHintsItem = document.createElement('li');
  tryHintsItem.textContent =
    t('modal.hintsInfoTryHints') || 'Try adding a position hint (object name).';
  troubleList.appendChild(tryHintsItem);

  const tryOnlineItem = document.createElement('li');
  tryOnlineItem.textContent = t('modal.hintsInfoTryOnline') || 'Use online solving if ASTAP fails.';
  troubleList.appendChild(tryOnlineItem);

  const manualItem = document.createElement('li');
  manualItem.textContent =
    t('modal.hintsInfoManual') || 'As a last resort, use manual star identification.';
  troubleList.appendChild(manualItem);

  tooltip.appendChild(troubleList);

  // Position near the icon
  _currentTooltipAnchor = anchorElement;
  document.body.appendChild(tooltip);

  const rect = anchorElement.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();

  // Position to the right of the icon if space, otherwise to the left
  let left = rect.right + 10;
  if (left + tooltipRect.width > window.innerWidth - 20) {
    left = rect.left - tooltipRect.width - 10;
  }

  let top = rect.top;
  if (top + tooltipRect.height > window.innerHeight - 20) {
    top = window.innerHeight - tooltipRect.height - 20;
  }

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;

  // Close on click outside
  const closeOnClickOutside = (e: MouseEvent) => {
    if (!tooltip.contains(e.target as Node) && !anchorElement.contains(e.target as Node)) {
      tooltip.remove();
      document.removeEventListener('click', closeOnClickOutside);
    }
  };
  setTimeout(() => {
    document.addEventListener('click', closeOnClickOutside);
  }, 100);
}

function showManualInfoTooltip(anchorElement: HTMLElement) {
  if (_dismissTooltip(anchorElement)) return;

  const tooltip = document.createElement('div');
  tooltip.className = 'hints-info-tooltip';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'hints-info-close';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => tooltip.remove());
  tooltip.appendChild(closeBtn);

  const title = document.createElement('h3');
  title.textContent = t('modal.manualInfoTitle');
  tooltip.appendChild(title);

  const intro = document.createElement('p');
  intro.textContent = t('modal.manualInfoWhen');
  tooltip.appendChild(intro);

  const methodsTitle = document.createElement('h4');
  methodsTitle.textContent = t('modal.manualInfoMethodsTitle');
  tooltip.appendChild(methodsTitle);

  const methodsList = document.createElement('ul');
  const mapItem = document.createElement('li');
  mapItem.innerHTML = t('modal.manualInfoMethodMap');
  methodsList.appendChild(mapItem);
  const starsItem = document.createElement('li');
  starsItem.innerHTML = t('modal.manualInfoMethodStars');
  methodsList.appendChild(starsItem);
  tooltip.appendChild(methodsList);

  const tipsTitle = document.createElement('h4');
  tipsTitle.textContent = t('modal.manualInfoTipsTitle');
  tooltip.appendChild(tipsTitle);

  const tipsList = document.createElement('ul');
  const suggestItem = document.createElement('li');
  suggestItem.textContent = t('modal.manualInfoSuggest');
  tipsList.appendChild(suggestItem);
  tooltip.appendChild(tipsList);

  _currentTooltipAnchor = anchorElement;
  document.body.appendChild(tooltip);

  const rect = anchorElement.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  let left = rect.right + 10;
  if (left + tooltipRect.width > window.innerWidth - 20) left = rect.left - tooltipRect.width - 10;
  let top = rect.top;
  if (top + tooltipRect.height > window.innerHeight - 20)
    top = window.innerHeight - tooltipRect.height - 20;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;

  const closeOnClickOutside = (e: MouseEvent) => {
    if (!tooltip.contains(e.target as Node) && !anchorElement.contains(e.target as Node)) {
      tooltip.remove();
      document.removeEventListener('click', closeOnClickOutside);
    }
  };
  setTimeout(() => {
    document.addEventListener('click', closeOnClickOutside);
  }, 100);
}

function showMetaInfoTooltip(anchorElement: HTMLElement) {
  if (_dismissTooltip(anchorElement)) return;

  const tooltip = document.createElement('div');
  tooltip.className = 'hints-info-tooltip';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'hints-info-close';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => tooltip.remove());
  tooltip.appendChild(closeBtn);

  const title = document.createElement('h3');
  title.textContent = t('modal.metaInfoTitle');
  tooltip.appendChild(title);

  const intro = document.createElement('p');
  intro.textContent = t('modal.metaInfoAuto');
  tooltip.appendChild(intro);

  const fieldsList = document.createElement('ul');
  for (const key of ['metaInfoDsos', 'metaInfoLabels', 'metaInfoNotes'] as const) {
    const item = document.createElement('li');
    item.innerHTML = t(`modal.${key}`);
    fieldsList.appendChild(item);
  }
  tooltip.appendChild(fieldsList);

  const editNote = document.createElement('p');
  editNote.className = 'photo-form-hint';
  editNote.textContent = t('modal.metaInfoEdit');
  tooltip.appendChild(editNote);

  _currentTooltipAnchor = anchorElement;
  document.body.appendChild(tooltip);

  const rect = anchorElement.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  let left = rect.right + 10;
  if (left + tooltipRect.width > window.innerWidth - 20) left = rect.left - tooltipRect.width - 10;
  let top = rect.top;
  if (top + tooltipRect.height > window.innerHeight - 20)
    top = window.innerHeight - tooltipRect.height - 20;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;

  const closeOnClickOutside = (e: MouseEvent) => {
    if (!tooltip.contains(e.target as Node) && !anchorElement.contains(e.target as Node)) {
      tooltip.remove();
      document.removeEventListener('click', closeOnClickOutside);
    }
  };
  setTimeout(() => {
    document.addEventListener('click', closeOnClickOutside);
  }, 100);
}

export class PhotoOverlay {
  private container: HTMLDivElement;
  private placedPhotos: PlacedPhoto[] = [];
  private getView: () => ViewState;
  private skyMap: SkyMap | null;
  private affineErrorShown = new Set<string>();
  private defaultOpacity = 1.0;
  private borderRadiusPU = Infinity; // projection-unit radius of the border circle
  private showPhotos = true; // Global toggle for all photos
  private visibleLabels: { [label: string]: boolean } = {};
  private visiblePois: Map<string, Set<string>> | null = null;
  private poiCategories: PoiCategory[] = [];

  constructor(container: HTMLDivElement, getView: () => ViewState, skyMap?: SkyMap) {
    this.container = container;
    this.getView = getView;
    this.skyMap = skyMap || null;
  }

  /**
   * Update the border parameters so photos whose centroid falls outside the
   * border circle are hidden.  Call whenever hemisphere or borderLatDeg changes.
   */
  setBorderParams(hemisphere: 'north' | 'south', borderLatDeg: number) {
    // In fisheye mode borderRadiusPU() returns 1.0 (horizon); in stereo it's the normal formula.
    this.borderRadiusPU = borderRadiusPU(borderLatDeg);
    void hemisphere;
  }

  private onPhotosChangedCallbacks: Array<() => void> = [];

  setOnPhotosChanged(cb: () => void) {
    this.onPhotosChangedCallbacks = [cb];
  }

  addOnPhotosChanged(cb: () => void) {
    this.onPhotosChangedCallbacks.push(cb);
  }

  setDefaultOpacity(v: number) {
    this.defaultOpacity = v;
  }

  private fireOnPhotosChanged() {
    for (const cb of this.onPhotosChangedCallbacks) {
      cb();
    }
  }

  /** True when the photo passes the current label filter (no filter ⇒ allowed). */
  private isLabelAllowed(placed: PlacedPhoto): boolean {
    return labelAllowed(placed.photo, this.visibleLabels);
  }

  /** True when the photo passes the current POI filter (no filter ⇒ allowed). */
  private isPoiAllowed(placed: PlacedPhoto): boolean {
    return poiAllowed(placed.photo, this.poiCategories, this.visiblePois);
  }

  private applyPhotoVisibility() {
    for (const placed of this.placedPhotos) {
      const shouldDisplay =
        this.showPhotos &&
        placed.visible &&
        this.isLabelAllowed(placed) &&
        this.isPoiAllowed(placed);
      placed.imgEl.style.display = shouldDisplay ? 'block' : 'none';
    }
  }

  setVisibleLabels(visibleLabels: { [label: string]: boolean }) {
    this.visibleLabels = visibleLabels || {};
    this.applyPhotoVisibility();
  }

  /** Provide the live category list so the POI filter resolves names + orphans. */
  setPoiCategories(categories: PoiCategory[]) {
    this.poiCategories = categories;
    this.applyPhotoVisibility();
  }

  /** Two-level sky POI filter; an empty map (or null) disables it. */
  setVisiblePois(selected: Map<string, Set<string>> | null) {
    this.visiblePois = selected && selected.size > 0 ? selected : null;
    this.applyPhotoVisibility();
  }

  setShowPhotos(show: boolean) {
    this.showPhotos = show;
    this.applyPhotoVisibility();
  }

  /** Load photos from server and display them */
  loadPhotos(photos: Photo[]) {
    for (const photo of photos) {
      this.addPhotoToMap(photo);
    }
    this.fireOnPhotosChanged();
  }

  /** Recalculate all photo transforms (call on zoom/pan/resize) */
  updateTransforms() {
    const view = this.getView();
    const gen = getProjectionGeneration();
    for (const placed of this.placedPhotos) {
      if (!placed.visible) continue;

      // Fast viewport cull: if we have a cached centroid, check whether the photo
      // could possibly overlap the canvas before doing the full transform.
      // Margin = 2× the photo's sky footprint radius in canvas pixels, so a photo
      // that extends past its correspondence points is never incorrectly hidden.
      // Only trust the cache when it was computed under the current projection
      // generation — a hemisphere/mode/center switch remaps every RA/Dec to a new
      // projection-space point, so a stale centroid would cull against the wrong
      // coordinates and, because a culled photo skips applyTransform, never refresh
      // (the photo stays hidden until forced, e.g. by toggling its visibility).
      if (
        placed.projCentroid !== null &&
        placed.projGen === gen &&
        isCentroidViewportCulled(placed.projCentroid, placed.projHalfDiag, view)
      ) {
        placed.viewportCulled = true;
        placed.imgEl.style.display = 'none';
        continue;
      }
      placed.viewportCulled = false;

      this.applyTransform(placed, view);
    }
  }

  getPlacedPhotos(): PlacedPhoto[] {
    return this.placedPhotos.filter((p) => !p.pendingDelete);
  }

  /**
   * Compute a placed photo's photo→canvas affine matrix at an arbitrary view,
   * independent of its current on-screen transform. Returns null when the photo
   * cannot be placed (too few correspondences) or its centroid falls outside the
   * border circle. Used by the "full sky map" export to position photos at a view
   * other than the live one.
   */
  computeMatrixForView(placed: PlacedPhoto, view: ViewState): AffineMatrix | null {
    return computePhotoMatrixForView(placed.photo, view, this.borderRadiusPU);
  }

  /**
   * Place a photo that was uploaded externally (e.g. from the batch modal).
   * Adds the photo to the map and fires onPhotosChanged so the side panel refreshes.
   */
  placeUploadedPhoto(photo: Photo): void {
    this.addPhotoToMap(photo);
    this.fireOnPhotosChanged();
  }

  /** Update in-memory photo data (dsoIds, labels, notes) after a metadata edit */
  updatePhotoData(updated: Photo): void {
    const idx = this.placedPhotos.findIndex((p) => p.photo.id === updated.id);
    if (idx >= 0) {
      // Replace with a new object so Vue's shallowRef detects the change via reference equality
      this.placedPhotos[idx] = { ...this.placedPhotos[idx], photo: updated };
      this.fireOnPhotosChanged();
    }
  }

  /** Compute canvas-space quadrilaterals for all visible photos */
  getPhotoCanvasQuads(view: ViewState): PhotoCanvasQuad[] {
    const results: PhotoCanvasQuad[] = [];

    for (const placed of this.placedPhotos) {
      if (!placed.visible || placed.borderHidden || placed.viewportCulled) continue;

      // Always uses stored dimensions so outlines are correct even when a thumbnail is loaded.
      const corners = computePhotoQuadCorners(placed.photo, view);
      if (!corners) continue; // < 2 correspondences or colinear points
      results.push({ id: placed.photo.id, name: placed.photo.originalName, corners });
    }

    return results;
  }

  /** Compute canvas-space outlines for sky-map hit testing. */
  getPhotoCanvasOutlines(view: ViewState): { name: string; corners: Point[] }[] {
    return this.getPhotoCanvasQuads(view).map(({ name, corners }) => ({ name, corners }));
  }

  /** Compute the center RA/Dec and ideal scale to fit a photo in the viewport */
  getPhotoCenterAndScale(
    photoId: string,
    viewWidth: number,
    viewHeight: number,
  ): { ra: number; dec: number; scale: number } | null {
    const placed = this.placedPhotos.find((p) => p.photo.id === photoId);
    if (!placed) return null;
    return computePhotoCenterAndScale(placed.photo, viewWidth, viewHeight);
  }

  /** Compute the average RA/Dec center of a photo from its star correspondences */
  getPhotoCenter(photoId: string): { ra: number; dec: number } | null {
    const placed = this.placedPhotos.find((p) => p.photo.id === photoId);
    if (!placed) return null;
    return computePhotoCenter(placed.photo);
  }

  setPhotoOpacity(photoId: string, opacity: number) {
    const placed = this.placedPhotos.find((p) => p.photo.id === photoId);
    if (!placed) return;
    placed.opacity = opacity;
    placed.imgEl.style.opacity = String(opacity);
  }

  toggleVisibility(photoId: string) {
    const placed = this.placedPhotos.find((p) => p.photo.id === photoId);
    if (!placed) return;
    placed.visible = !placed.visible;
    const shouldDisplay = this.showPhotos && placed.visible;
    placed.imgEl.style.display = shouldDisplay ? 'block' : 'none';
    if (shouldDisplay) {
      this.applyTransform(placed, this.getView());
    }
  }

  setMultiplePhotosVisible(photoIds: string[], visible: boolean) {
    const view = this.getView();
    for (const id of photoIds) {
      const placed = this.placedPhotos.find((p) => p.photo.id === id);
      if (!placed) continue;
      placed.visible = visible;
      const shouldDisplay = this.showPhotos && visible;
      placed.imgEl.style.display = shouldDisplay ? 'block' : 'none';
      if (shouldDisplay) {
        this.applyTransform(placed, view);
      }
    }
    this.fireOnPhotosChanged();
  }

  movePhotoUp(photoId: string) {
    const idx = this.placedPhotos.findIndex((p) => p.photo.id === photoId);
    if (idx < 0 || idx >= this.placedPhotos.length - 1) return;
    [this.placedPhotos[idx], this.placedPhotos[idx + 1]] = [
      this.placedPhotos[idx + 1],
      this.placedPhotos[idx],
    ];
    this.reorderDOM();
    this.fireOnPhotosChanged();
  }

  movePhotoDown(photoId: string) {
    const idx = this.placedPhotos.findIndex((p) => p.photo.id === photoId);
    if (idx <= 0) return;
    [this.placedPhotos[idx], this.placedPhotos[idx - 1]] = [
      this.placedPhotos[idx - 1],
      this.placedPhotos[idx],
    ];
    this.reorderDOM();
    this.fireOnPhotosChanged();
  }

  reorderPhoto(photoId: string, newIndex: number) {
    const oldIdx = this.placedPhotos.findIndex((p) => p.photo.id === photoId);
    if (oldIdx < 0 || newIndex < 0 || newIndex >= this.placedPhotos.length || oldIdx === newIndex)
      return;
    const [item] = this.placedPhotos.splice(oldIdx, 1);
    this.placedPhotos.splice(newIndex, 0, item);
    this.reorderDOM();
    this.fireOnPhotosChanged();
  }

  setPhotoOrder(photoIds: string[]) {
    if (photoIds.length === 0) return;

    const placedById = new Map(this.placedPhotos.map((placed) => [placed.photo.id, placed]));
    const reordered: PlacedPhoto[] = [];
    const seen = new Set<string>();

    for (const photoId of photoIds) {
      const placed = placedById.get(photoId);
      if (!placed) continue;
      reordered.push(placed);
      seen.add(photoId);
    }

    for (const placed of this.placedPhotos) {
      if (!seen.has(placed.photo.id)) {
        reordered.push(placed);
      }
    }

    if (reordered.length !== this.placedPhotos.length) return;

    this.placedPhotos = reordered;
    this.reorderDOM();
    this.fireOnPhotosChanged();
  }

  private reorderDOM() {
    for (const placed of this.placedPhotos) {
      this.container.appendChild(placed.imgEl);
    }
  }

  hidePhoto(photoId: string) {
    const placed = this.placedPhotos.find((p) => p.photo.id === photoId);
    if (!placed) return;
    placed.pendingDelete = true;
    placed.imgEl.style.display = 'none';
    this.fireOnPhotosChanged();
  }

  unhidePhoto(photoId: string) {
    const placed = this.placedPhotos.find((p) => p.photo.id === photoId);
    if (!placed) return;
    placed.pendingDelete = false;
    placed.imgEl.style.display = placed.visible ? 'block' : 'none';
    if (placed.visible) {
      this.applyTransform(placed, this.getView());
    }
    this.fireOnPhotosChanged();
  }

  async removePhoto(photoId: string) {
    try {
      await deletePhotoAPI(photoId);
    } catch (err: any) {
      showToast({
        message: t('photos.deleteError', { message: err.message }),
        type: 'error',
        duration: 5000,
      });
      return;
    }
    const idx = this.placedPhotos.findIndex((p) => p.photo.id === photoId);
    if (idx >= 0) {
      this.placedPhotos[idx].imgEl.remove();
      this.placedPhotos.splice(idx, 1);
    }
    this.fireOnPhotosChanged();
  }

  /** Remove specific photos from the in-memory overlay without calling the API (call bulk API first). */
  removePhotosFromMap(ids: string[]) {
    const idSet = new Set(ids);
    const removed = this.placedPhotos.filter((p) => idSet.has(p.photo.id));
    removed.forEach((p) => p.imgEl.remove());
    this.placedPhotos = this.placedPhotos.filter((p) => !idSet.has(p.photo.id));
    if (removed.length > 0) this.fireOnPhotosChanged();
  }

  /** Remove all photos from the in-memory overlay without calling the API. */
  clearAllPhotos() {
    this.placedPhotos.forEach((p) => p.imgEl.remove());
    this.placedPhotos = [];
    this.fireOnPhotosChanged();
  }

  private addPhotoToMap(photo: Photo) {
    // Check if photo already exists
    const existing = this.placedPhotos.find((p) => p.photo.id === photo.id);
    if (existing) {
      console.log(`[addPhotoToMap] Photo ${photo.originalName} already exists, skipping duplicate`);
      return;
    }

    const img = document.createElement('img');
    img.src = `/uploads/${photo.filename}`;
    img.className = 'photo-overlay-img';
    img.draggable = false;
    img.style.visibility = 'hidden'; // Hide until loaded
    // Pin to full-image dims: affine matrix is in full-image pixel space; thumbnail LOD src swaps must not change the coordinate space.
    img.style.width = `${photo.width}px`;
    img.style.height = `${photo.height}px`;
    this.container.appendChild(img);

    img.style.opacity = String(this.defaultOpacity);
    const placed: PlacedPhoto = {
      photo,
      imgEl: img,
      visible: true,
      opacity: this.defaultOpacity,
      borderHidden: false,
      viewportCulled: false,
      projCentroid: null,
      projHalfDiag: 0,
      projGen: -1,
    };
    this.placedPhotos.push(placed);

    img.onload = () => {
      // Only validate dimensions for the full-resolution image. The LOD swap loads a 400px
      // thumbnail (server/index.ts) which is intentionally smaller, so assert dims only when
      // the currently loaded src is the full image.
      const isFullImage = img.src.endsWith(`/uploads/${photo.filename}`);
      if (isFullImage && (img.naturalWidth !== photo.width || img.naturalHeight !== photo.height)) {
        reportUnknownRendererError(
          'photo_dimension_mismatch',
          new Error(
            `Expected ${photo.width}×${photo.height} but got ${img.naturalWidth}×${img.naturalHeight}`,
          ),
          {
            photoName: photo.originalName,
            expected: `${photo.width}×${photo.height}`,
            actual: `${img.naturalWidth}×${img.naturalHeight}`,
          },
        );
      }

      img.style.visibility = 'visible';
      this.applyTransform(placed, this.getView());
    };
  }

  private applyTransform(placed: PlacedPhoto, view: ViewState) {
    const { photo, imgEl } = placed;

    // If this photo has manual placement params, use them directly to compute the transform
    if (photo.manualPlacement) {
      const { centroid, halfDiag } = manualPlacementCentroid(
        photo.manualPlacement,
        photo.width,
        photo.height,
      );
      placed.projCentroid = centroid;
      placed.projGen = getProjectionGeneration();
      placed.projHalfDiag = halfDiag;
      imgEl.style.display = this.showPhotos && this.isLabelAllowed(placed) ? 'block' : 'none';
      applyManualTransform(imgEl, photo.manualPlacement, view, photo.width, photo.height);
      return;
    }

    if (photo.correspondences.length < 2) return;

    const { photoPoints, projPoints, canvasPoints } = buildPhotoPoints(photo, view);
    if (photoPoints.length < 2) return;

    // Compute centroid in projection space and cache it for viewport culling.
    const { centroid, halfDiag } = projCentroidAndHalfDiag(projPoints);
    placed.projCentroid = centroid;
    placed.projGen = getProjectionGeneration();
    placed.projHalfDiag = halfDiag;

    // Check if photo centroid is inside the border circle
    if (!isCentroidInsideBorder(centroid, this.borderRadiusPU)) {
      placed.borderHidden = true;
      imgEl.style.display = 'none';
      return;
    }
    placed.borderHidden = false;
    imgEl.style.display = this.showPhotos && this.isLabelAllowed(placed) ? 'block' : 'none';

    try {
      const matrix = fitPhotoAffine(photoPoints, canvasPoints);
      imgEl.style.transform = affineToCSS(matrix);

      // LOD: swap to thumbnail when the photo renders small on screen
      if (photo.thumbFilename) {
        const renderedWidth = Math.sqrt(matrix.a ** 2 + matrix.b ** 2) * photo.width;
        const wantThumb = renderedWidth < 300;
        const thumbSrc = `/uploads/${photo.thumbFilename}`;
        const fullSrc = `/uploads/${photo.filename}`;
        const currentSrc = imgEl.src.endsWith(thumbSrc) ? thumbSrc : fullSrc;
        const desiredSrc = wantThumb ? thumbSrc : fullSrc;
        if (currentSrc !== desiredSrc) imgEl.src = desiredSrc;
      }
    } catch {
      imgEl.style.display = 'none';
      if (!this.affineErrorShown.has(photo.id)) {
        this.affineErrorShown.add(photo.id);
        showToast({
          message: t('photos.placementError', { name: photo.originalName }),
          type: 'error',
          duration: 5000,
        });
      }
    }
  }

  async showSubmissionSelectionDialog(options?: {
    allowUpload?: boolean;
  }): Promise<{ action: 'upload' | 'reuse' | 'cancel'; jobId?: number }> {
    return new Promise((resolve) => {
      const allowUpload = options?.allowUpload ?? true;
      let currentPage = 0;
      let allSubmissions: any[] = [];
      const itemsPerPage = 20;

      // Create modal backdrop
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';

      // Create modal
      const modal = document.createElement('div');
      modal.className = 'registration-modal submission-selection-modal';

      // Header
      const header = document.createElement('div');
      header.className = 'modal-header';

      const titleContainer = document.createElement('div');
      titleContainer.className = 'modal-title-group';

      const title = document.createElement('h2');
      title.textContent = t('modal.reuseOrUpload');
      titleContainer.appendChild(title);

      const subtitle = document.createElement('div');
      subtitle.className = 'modal-subtitle';
      subtitle.textContent = t('modal.submissionList');
      titleContainer.appendChild(subtitle);

      header.appendChild(titleContainer);

      const closeBtn = document.createElement('button');
      closeBtn.className = 'modal-close';
      closeBtn.textContent = '×';
      closeBtn.onclick = () => {
        document.body.removeChild(backdrop);
        resolve({ action: 'cancel' });
      };
      header.appendChild(closeBtn);

      modal.appendChild(header);

      // Content container (scrollable)
      const content = document.createElement('div');
      content.className = 'modal-scroll';

      // Loading indicator
      const loading = document.createElement('div');
      loading.className = 'modal-loading-placeholder';
      loading.innerHTML =
        '<div class="auto-solve-spinner"></div><div style="margin-top: 12px;">' +
        t('modal.loadingSubmissions') +
        '</div>';
      content.appendChild(loading);

      modal.appendChild(content);

      // Footer with pagination and buttons
      const footer = document.createElement('div');
      footer.className = 'astrometry-modal-footer';

      // Pagination controls
      const paginationContainer = document.createElement('div');
      paginationContainer.className = 'pagination-bar hidden';

      const pageInfo = document.createElement('div');
      pageInfo.className = 'pagination-info';
      paginationContainer.appendChild(pageInfo);

      const pageButtons = document.createElement('div');
      pageButtons.className = 'pagination-btn-group';

      const prevBtn = document.createElement('button');
      prevBtn.className = 'btn-secondary';
      prevBtn.textContent = t('modal.prevPage');
      prevBtn.disabled = true;
      pageButtons.appendChild(prevBtn);

      const nextBtn = document.createElement('button');
      nextBtn.className = 'btn-secondary';
      nextBtn.textContent = t('modal.nextPage');
      nextBtn.disabled = true;
      pageButtons.appendChild(nextBtn);

      const refreshBtn = document.createElement('button');
      refreshBtn.className = 'btn-secondary';
      refreshBtn.textContent = t('modal.refreshSubmissions');
      refreshBtn.title = t('modal.refreshSubmissions');
      pageButtons.appendChild(refreshBtn);

      paginationContainer.appendChild(pageButtons);
      footer.appendChild(paginationContainer);

      // Action buttons
      const buttonsContainer = document.createElement('div');
      buttonsContainer.className = 'modal-action-row';

      if (allowUpload) {
        const uploadButton = document.createElement('button');
        uploadButton.className = 'btn-action';
        uploadButton.textContent = t('modal.uploadThisImage');
        uploadButton.onclick = () => {
          document.body.removeChild(backdrop);
          resolve({ action: 'upload' });
        };
        buttonsContainer.appendChild(uploadButton);
      }

      footer.appendChild(buttonsContainer);
      modal.appendChild(footer);

      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);

      // Function to render current page
      function renderPage() {
        const totalPages = Math.ceil(allSubmissions.length / itemsPerPage);
        const start = currentPage * itemsPerPage;
        const end = start + itemsPerPage;
        const pageSubmissions = allSubmissions.slice(start, end);

        content.innerHTML = '';

        if (allSubmissions.length === 0) {
          const noSubmissions = document.createElement('div');
          noSubmissions.className = 'modal-loading-placeholder';
          noSubmissions.textContent = t('modal.noSubmissions');
          content.appendChild(noSubmissions);
          paginationContainer.classList.add('hidden');
          return;
        }

        // Show pagination
        paginationContainer.classList.remove('hidden');
        pageInfo.textContent =
          t('modal.submissionPage', { current: currentPage + 1, total: totalPages }) +
          ' — ' +
          t('modal.submissionCount', { count: allSubmissions.length });
        prevBtn.disabled = currentPage === 0;
        nextBtn.disabled = currentPage >= totalPages - 1;

        // Render submissions
        const list = document.createElement('div');
        list.className = 'submission-list';

        for (const sub of pageSubmissions) {
          if (!sub.jobId) continue;

          const item = document.createElement('button');
          item.className = 'submission-item';

          const itemInfo = document.createElement('div');
          itemInfo.className = 'submission-item-info';

          const itemTitle = document.createElement('div');
          itemTitle.className = 'submission-item-title';
          itemTitle.textContent = sub.filename || `Job #${sub.jobId}`;
          itemInfo.appendChild(itemTitle);

          const itemSubtitle = document.createElement('div');
          itemSubtitle.className = 'submission-item-subtitle';
          const dimsText =
            typeof sub.width === 'number' && typeof sub.height === 'number'
              ? ` - ${sub.width}x${sub.height}px`
              : '';
          itemSubtitle.textContent = `Job #${sub.jobId}${dimsText}`;
          itemInfo.appendChild(itemSubtitle);

          item.appendChild(itemInfo);

          const statusBadge = document.createElement('div');
          statusBadge.className = 'submission-status-badge';
          if (sub.status === 'success') {
            statusBadge.classList.add('submission-status-badge--success');
            statusBadge.textContent = '✓ Success';
          } else {
            statusBadge.classList.add('submission-status-badge--pending');
            statusBadge.textContent = sub.status;
          }
          item.appendChild(statusBadge);

          item.onclick = () => {
            document.body.removeChild(backdrop);
            resolve({ action: 'reuse', jobId: sub.jobId });
          };
          list.appendChild(item);
        }

        content.appendChild(list);
      }

      // Pagination button handlers
      prevBtn.onclick = () => {
        if (currentPage > 0) {
          currentPage--;
          renderPage();
        }
      };

      prevBtn.onmouseenter = () => {
        if (!prevBtn.disabled) {
          prevBtn.style.background = 'rgba(80, 120, 200, 0.5)';
        }
      };
      prevBtn.onmouseleave = () => {
        prevBtn.style.background = 'rgba(60, 100, 180, 0.3)';
      };

      nextBtn.onclick = () => {
        const totalPages = Math.ceil(allSubmissions.length / itemsPerPage);
        if (currentPage < totalPages - 1) {
          currentPage++;
          renderPage();
        }
      };

      nextBtn.onmouseenter = () => {
        if (!nextBtn.disabled) {
          nextBtn.style.background = 'rgba(80, 120, 200, 0.5)';
        }
      };
      nextBtn.onmouseleave = () => {
        nextBtn.style.background = 'rgba(60, 100, 180, 0.3)';
      };

      function fetchAndRenderSubmissions(forceRefresh = false) {
        refreshBtn.disabled = true;
        refreshBtn.textContent = forceRefresh ? '…' : t('modal.refreshSubmissions');
        return loadAstrometrySubmissionsWithCache(forceRefresh)
          .then((submissions) => {
            allSubmissions = submissions;
            currentPage = 0;
            renderPage();
          })
          .catch((err) => {
            reportUnknownRendererError('astrometry_list_submissions', err);
            content.innerHTML = '';

            const error = document.createElement('div');
            error.className = 'modal-loading-error';
            error.innerHTML = `<div style="font-size: 24px; margin-bottom: 8px;">⚠</div><div>${err.message || 'Failed to load submissions'}</div>`;
            content.appendChild(error);
          })
          .finally(() => {
            refreshBtn.disabled = false;
            refreshBtn.textContent = t('modal.refreshSubmissions');
          });
      }

      refreshBtn.onclick = () => {
        void fetchAndRenderSubmissions(true);
      };

      // Fetch submissions
      void fetchAndRenderSubmissions(false);
    });
  }

  /**
   * Open the manual star-identification sub-modal for a single file.
   *
   * Shows the photo preview and lets the user click up to 3 points and identify
   * each via star search / RA-Dec entry / map pick, plus a hint-driven
   * "suggest stars" helper and a free-drag "place on map" hand-off. There are
   * no plate-solving buttons and no metadata editor — those live in the batch card.
   *
   * Resolves with:
   *  - `{ action: 'validate', correspondences }` when the user clicks Validate
   *    (enabled once 2+ points are identified),
   *  - `{ action: 'manual-placement' }` if they hand off to free-drag placement
   *    (which self-saves and places the photo), or
   *  - `{ action: 'cancel' }` otherwise.
   */
  openManualIdentifyModal(
    file: File,
    opts?: {
      initialMeta?: {
        originalName?: string;
        dsoIds: string[];
        labels: string[];
        pointsOfInterest?: PointOfInterest[];
        integrations?: PhotoIntegration[];
        observationDate?: string | null;
        notes: string;
      };
    },
  ): Promise<ManualIdentifyResult> {
    return new Promise<ManualIdentifyResult>((resolve) => {
      const skyMap = this.skyMap;

      // State
      const points: (PhotoCorrespondence | null)[] = [null, null, null];
      let activeIndex = 0;
      let naturalWidth = 0;
      let naturalHeight = 0;
      let settled = false;

      // Create modal backdrop
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';

      const modal = document.createElement('div');
      modal.className = 'modal';

      // Header
      const header = document.createElement('div');
      header.className = 'modal-header';
      header.innerHTML = `
        <h2>${t('modal.manualIdentifyTitle', { name: stripExtension(file.name) })}</h2>
        <button class="modal-close">&times;</button>
      `;
      modal.appendChild(header);

      let zoom: ReturnType<typeof createImageZoomPan> | null = null;

      function finish(result: ManualIdentifyResult) {
        if (settled) return;
        settled = true;
        zoom?.destroy();
        document.removeEventListener('click', onDocClick);
        backdrop.remove();
        resolve(result);
      }

      function closeModal() {
        finish({ action: 'cancel' });
      }

      header.querySelector('.modal-close')!.addEventListener('click', closeModal);

      // Body
      const body = document.createElement('div');
      body.className = 'modal-body';

      // Left: photo
      const photoSide = document.createElement('div');
      photoSide.className = 'modal-photo-side';

      const photoWrapper = document.createElement('div');
      photoWrapper.className = 'modal-photo-wrapper';

      const photoContainer = document.createElement('div');
      photoContainer.className = 'modal-photo-container';

      const photoImg = document.createElement('img');
      photoImg.className = 'modal-photo';
      photoContainer.appendChild(photoImg);
      photoWrapper.appendChild(photoContainer);
      photoSide.appendChild(photoWrapper);

      // Right: form
      const formSide = document.createElement('div');
      formSide.className = 'modal-form-side';

      // Instructions
      const manualInstructions = document.createElement('p');
      manualInstructions.className = 'modal-instructions';
      manualInstructions.textContent = t('modal.manualInstructions');
      formSide.appendChild(manualInstructions);

      // Direct map placement button (free-drag, no star matching)
      const manualBtn = document.createElement('button');
      manualBtn.type = 'button';
      manualBtn.className = 'btn-auto-solve full-width';
      manualBtn.textContent = t('modal.manualButton');
      manualBtn.title = t('modal.manualTooltip');
      formSide.appendChild(manualBtn);

      manualBtn.addEventListener('click', () => {
        const initialMeta = opts?.initialMeta ?? {
          originalName: stripExtension(file.name),
          dsoIds: [],
          labels: [],
          pointsOfInterest: [],
          integrations: [],
          observationDate: null,
          notes: '',
        };
        // Hand off to the free-drag placement flow (it self-saves & places the photo).
        finish({ action: 'manual-placement' });
        this.openManualPlacement(file, initialMeta);
      });

      // Divider between map placement and star identification
      const divider = document.createElement('div');
      divider.className = 'modal-panel-divider';
      formSide.appendChild(divider);

      // --- Hint + "suggest stars" helper ---
      const hintsSection = document.createElement('div');
      hintsSection.className = 'solve-hints-section';

      const hintsHeaderRow = document.createElement('div');
      hintsHeaderRow.className = 'hints-header-row';

      const hintsBulb = document.createElement('span');
      hintsBulb.className = 'hints-bulb-icon';
      hintsBulb.textContent = '💡';
      hintsHeaderRow.appendChild(hintsBulb);

      const hintsLabelText = document.createElement('span');
      hintsLabelText.className = 'hints-label-text';
      hintsLabelText.textContent = t('modal.hintsOptional');
      hintsHeaderRow.appendChild(hintsLabelText);

      const hintsClearBtn = document.createElement('button');
      hintsClearBtn.type = 'button';
      hintsClearBtn.className = 'hints-clear-btn';
      hintsClearBtn.textContent = '×';
      hintsClearBtn.title = t('modal.hintsClear');
      hintsHeaderRow.appendChild(hintsClearBtn);

      hintsSection.appendChild(hintsHeaderRow);

      const hintsInput = document.createElement('input');
      hintsInput.type = 'text';
      hintsInput.className = 'star-search-input w-full text-base';
      hintsInput.placeholder = t('modal.hintsPlaceholder');
      hintsSection.appendChild(hintsInput);

      const hintsDropdown = document.createElement('div');
      hintsDropdown.className = 'search-results-dropdown';
      hintsDropdown.style.display = 'none';
      hintsSection.appendChild(hintsDropdown);

      formSide.appendChild(hintsSection);

      // Store selected hint coordinates and target name
      let hintCoords: { ra: number; dec: number } | null = null;
      let hintTargetName = '';

      // Hints search handler
      let hintsTimeout: any;
      hintsInput.addEventListener('input', () => {
        clearTimeout(hintsTimeout);
        const query = hintsInput.value.trim();
        if (query.length < 2) {
          hintsDropdown.style.display = 'none';
          return;
        }
        hintsTimeout = setTimeout(async () => {
          try {
            const results = await searchUnified(query, 5);
            if (results.length === 0) {
              hintsDropdown.style.display = 'none';
              hintCoords = null;
              return;
            }
            hintsDropdown.innerHTML = '';
            hintsDropdown.style.display = 'block';
            results.forEach((result: any) => {
              const item = document.createElement('div');
              item.className = 'result-item';
              item.style.cursor = 'pointer';
              const label = document.createElement('div');
              label.textContent = result.label;
              item.appendChild(label);
              const coords = document.createElement('div');
              coords.className = 'star-coords';
              coords.textContent = `RA: ${result.ra.toFixed(2)}° Dec: ${result.dec.toFixed(2)}°`;
              item.appendChild(coords);
              item.addEventListener('click', () => {
                hintCoords = { ra: result.ra, dec: result.dec };
                hintTargetName = result.label;
                hintsInput.value = result.label;
                hintsDropdown.style.display = 'none';
                hintsSection.classList.add('has-hint');
                suggestBtn.disabled = false;
                suggestBtn.title = '';
                suggestList.innerHTML = '';
                suggestList.classList.add('hidden');
              });
              hintsDropdown.appendChild(item);
            });
          } catch (err) {
            reportUnknownRendererError('hints_search_error', err);
          }
        }, 500);
      });

      hintsInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && hintsDropdown.style.display === 'block') {
          e.preventDefault();
          const firstItem = hintsDropdown.querySelector('div');
          if (firstItem) firstItem.click();
        }
      });

      hintsClearBtn.addEventListener('click', () => {
        hintCoords = null;
        hintTargetName = '';
        hintsInput.value = '';
        hintsSection.classList.remove('has-hint');
        suggestBtn.disabled = true;
        suggestList.innerHTML = '';
        suggestList.classList.add('hidden');
      });

      const onDocClick = (e: MouseEvent) => {
        if (!hintsSection.contains(e.target as Node)) {
          hintsDropdown.style.display = 'none';
        }
      };
      document.addEventListener('click', onDocClick);

      // Suggest stars section
      const suggestSection = document.createElement('div');
      suggestSection.className = 'suggest-stars-section';

      const suggestControls = document.createElement('div');
      suggestControls.className = 'suggest-controls';

      const suggestBtn = document.createElement('button');
      suggestBtn.type = 'button';
      suggestBtn.className = 'btn-auto-solve suggest-btn';
      suggestBtn.textContent = t('lightSolve.suggestButton');
      suggestBtn.disabled = true;
      suggestBtn.title = t('lightSolve.requiresHint');
      suggestControls.appendChild(suggestBtn);

      const radiusLabel = document.createElement('span');
      radiusLabel.className = 'suggest-radius-label';
      radiusLabel.textContent = 'within';
      suggestControls.appendChild(radiusLabel);

      const radiusInput = document.createElement('input');
      radiusInput.type = 'number';
      radiusInput.value = '2';
      radiusInput.min = '0.1';
      radiusInput.max = '10';
      radiusInput.step = '0.5';
      radiusInput.className = 'suggest-radius-input';
      suggestControls.appendChild(radiusInput);

      const radiusUnit = document.createElement('span');
      radiusUnit.className = 'suggest-radius-unit';
      radiusUnit.textContent = '°';
      suggestControls.appendChild(radiusUnit);

      suggestSection.appendChild(suggestControls);

      const suggestList = document.createElement('div');
      suggestList.className = 'suggest-stars-list suggest-list hidden';
      suggestSection.appendChild(suggestList);

      formSide.appendChild(suggestSection);

      suggestBtn.addEventListener('click', async () => {
        if (!hintCoords) return;
        try {
          suggestBtn.disabled = true;
          suggestBtn.textContent = t('lightSolve.searching');
          suggestList.innerHTML = '';
          suggestList.classList.add('hidden');

          const searchRadius = parseFloat(radiusInput.value) || 2.0;
          const nearbyStars = await searchStarsByPosition({
            ra: hintCoords.ra,
            dec: hintCoords.dec,
            radius: searchRadius,
            magLimit: 10,
            limit: 20,
          });

          suggestBtn.textContent = t('lightSolve.suggestButton');
          suggestBtn.disabled = false;

          if (nearbyStars.length === 0) {
            suggestList.innerHTML = `<div class="suggest-list-header">${t('lightSolve.noStarsNearby', { radius: searchRadius.toFixed(1) })}</div>`;
            suggestList.classList.remove('hidden');
            return;
          }

          const starsWithDistance = nearbyStars.map((star) => {
            const dRa = (star.ra - hintCoords!.ra) * Math.cos((star.dec * Math.PI) / 180);
            const dDec = star.dec - hintCoords!.dec;
            const distance = Math.sqrt(dRa * dRa + dDec * dDec);
            return { star, distance };
          });
          starsWithDistance.sort((a, b) => a.distance - b.distance);

          const listHeader = document.createElement('div');
          listHeader.className = 'suggest-list-header';
          listHeader.textContent = t('lightSolve.foundNearby', {
            count: nearbyStars.length,
            target: hintTargetName,
            radius: searchRadius.toFixed(1),
          });
          suggestList.appendChild(listHeader);

          starsWithDistance.slice(0, 10).forEach(({ star, distance }) => {
            const starItem = document.createElement('div');
            starItem.className = 'suggest-list-item';
            starItem.innerHTML = `
              <div class="suggest-item-name">${star.name || `HIP ${star.hip}`}</div>
              <div class="suggest-item-meta">
                mag ${star.mag.toFixed(1)} — ${distance.toFixed(2)}° from target
              </div>
            `;
            starItem.addEventListener('click', () => {
              const activeIdx = points.findIndex((p) => p === null);
              if (activeIdx === -1) return;
              showToast({
                message: t('lightSolve.lookForStar', {
                  name: star.name || `HIP ${star.hip}`,
                  mag: star.mag.toFixed(1),
                }),
                type: 'info',
                duration: 5000,
              });
            });
            suggestList.appendChild(starItem);
          });

          suggestList.classList.remove('hidden');
        } catch (err: any) {
          reportUnknownRendererError('suggest_stars_error', err);
          suggestBtn.textContent = t('lightSolve.suggestButton');
          suggestBtn.disabled = false;
          showToast({
            message: err.message || t('lightSolve.searchFailed'),
            type: 'error',
            duration: 3000,
          });
        }
      });

      // --- 3 point entries ---
      const pointEntries: HTMLDivElement[] = [];
      const searchInputs: HTMLInputElement[] = [];
      const dropdowns: HTMLDivElement[] = [];
      const statusLabels: HTMLSpanElement[] = [];
      const pickBtns: HTMLButtonElement[] = [];

      for (let i = 0; i < 3; i++) {
        const entry = document.createElement('div');
        entry.className = 'point-entry';
        entry.dataset.index = String(i);

        const markerDot = document.createElement('span');
        markerDot.className = 'marker-dot';
        markerDot.style.backgroundColor = MARKER_COLORS[i];
        markerDot.textContent = String(i + 1);

        const info = document.createElement('div');
        info.className = 'point-info';

        const status = document.createElement('span');
        status.className = 'point-status';
        status.textContent = i === 0 ? t('modal.clickPhoto') : t('modal.waiting');
        statusLabels.push(status);

        const searchWrapper = document.createElement('div');
        searchWrapper.className = 'search-wrapper';
        searchWrapper.style.display = 'none';

        // --- Star search row ---
        const searchRow = document.createElement('div');
        searchRow.className = 'search-row';

        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = t('modal.searchStar');
        searchInput.className = 'star-search-input';
        searchInputs.push(searchInput);

        searchRow.appendChild(searchInput);

        // "Map" pick button (only if skyMap available)
        if (skyMap) {
          const pickBtn = document.createElement('button');
          pickBtn.type = 'button';
          pickBtn.className = 'btn-pick-map';
          pickBtn.title = t('modal.mapPickTooltip');
          pickBtn.textContent = t('modal.mapPick');
          pickBtns.push(pickBtn);
          searchRow.appendChild(pickBtn);

          pickBtn.addEventListener('click', () => {
            backdrop.style.display = 'none';
            skyMap.enterPickingMode((star: Star) => {
              skyMap.exitPickingMode();
              backdrop.style.display = '';
              selectStar(i, star, starDisplayLabel(star));
            });
            const escHandler = (e: KeyboardEvent) => {
              if (e.key === 'Escape') {
                skyMap.exitPickingMode();
                backdrop.style.display = '';
                window.removeEventListener('keydown', escHandler);
              }
            };
            window.addEventListener('keydown', escHandler);
          });
        }

        // RA/Dec mode toggle button
        const raDecToggle = document.createElement('button');
        raDecToggle.type = 'button';
        raDecToggle.className = 'btn-pick-map';
        raDecToggle.title = t('modal.raDecTooltip');
        raDecToggle.textContent = t('modal.raDecMode');
        searchRow.appendChild(raDecToggle);

        // --- RA/Dec input row (hidden by default) ---
        const raDecRow = document.createElement('div');
        raDecRow.className = 'search-row radec-row';
        raDecRow.style.display = 'none';
        raDecRow.style.flexDirection = 'column';
        raDecRow.style.gap = '8px';

        const raContainer = document.createElement('div');
        raContainer.style.display = 'flex';
        raContainer.style.flexDirection = 'column';
        raContainer.style.gap = '4px';

        const raLabel = document.createElement('label');
        raLabel.textContent = t('modal.raLabel');
        raLabel.style.fontSize = '0.9em';
        raLabel.style.opacity = '0.8';
        raContainer.appendChild(raLabel);

        const raInputs = document.createElement('div');
        raInputs.style.display = 'flex';
        raInputs.style.gap = '4px';

        const raHours = document.createElement('input');
        raHours.type = 'number';
        raHours.placeholder = t('modal.raHours');
        raHours.className = 'radec-input-small';
        raHours.min = '0';
        raHours.max = '23';
        raHours.step = '1';

        const raMinutes = document.createElement('input');
        raMinutes.type = 'number';
        raMinutes.placeholder = t('modal.raMinutes');
        raMinutes.className = 'radec-input-small';
        raMinutes.min = '0';
        raMinutes.max = '59';
        raMinutes.step = '1';

        const raSeconds = document.createElement('input');
        raSeconds.type = 'number';
        raSeconds.placeholder = t('modal.raSeconds');
        raSeconds.className = 'radec-input-small';
        raSeconds.min = '0';
        raSeconds.max = '59';
        raSeconds.step = '0.01';

        raInputs.appendChild(raHours);
        raInputs.appendChild(raMinutes);
        raInputs.appendChild(raSeconds);
        raContainer.appendChild(raInputs);

        const decContainer = document.createElement('div');
        decContainer.style.display = 'flex';
        decContainer.style.flexDirection = 'column';
        decContainer.style.gap = '4px';

        const decLabel = document.createElement('label');
        decLabel.textContent = t('modal.decLabel');
        decLabel.style.fontSize = '0.9em';
        decLabel.style.opacity = '0.8';
        decContainer.appendChild(decLabel);

        const decInputs = document.createElement('div');
        decInputs.style.display = 'flex';
        decInputs.style.gap = '4px';

        const decDegrees = document.createElement('input');
        decDegrees.type = 'number';
        decDegrees.placeholder = t('modal.decDegrees');
        decDegrees.className = 'radec-input-small';
        decDegrees.min = '-89';
        decDegrees.max = '89';
        decDegrees.step = '1';

        const decMinutes = document.createElement('input');
        decMinutes.type = 'number';
        decMinutes.placeholder = t('modal.decMinutes');
        decMinutes.className = 'radec-input-small';
        decMinutes.min = '0';
        decMinutes.max = '59';
        decMinutes.step = '1';

        const decSeconds = document.createElement('input');
        decSeconds.type = 'number';
        decSeconds.placeholder = t('modal.decSeconds');
        decSeconds.className = 'radec-input-small';
        decSeconds.min = '0';
        decSeconds.max = '59';
        decSeconds.step = '0.01';

        decInputs.appendChild(decDegrees);
        decInputs.appendChild(decMinutes);
        decInputs.appendChild(decSeconds);
        decContainer.appendChild(decInputs);

        const buttonsContainer = document.createElement('div');
        buttonsContainer.style.display = 'flex';
        buttonsContainer.style.gap = '8px';
        buttonsContainer.style.marginTop = '4px';

        const raDecOk = document.createElement('button');
        raDecOk.type = 'button';
        raDecOk.className = 'btn-pick-map';
        raDecOk.textContent = 'OK';

        const starToggle = document.createElement('button');
        starToggle.type = 'button';
        starToggle.className = 'btn-pick-map';
        starToggle.title = t('modal.starModeTooltip');
        starToggle.textContent = t('modal.starMode');

        buttonsContainer.appendChild(raDecOk);
        buttonsContainer.appendChild(starToggle);

        raDecRow.appendChild(raContainer);
        raDecRow.appendChild(decContainer);
        raDecRow.appendChild(buttonsContainer);

        raDecToggle.addEventListener('click', () => {
          searchRow.style.display = 'none';
          raDecRow.style.display = 'flex';
          raHours.focus();
        });
        starToggle.addEventListener('click', () => {
          raDecRow.style.display = 'none';
          searchRow.style.display = '';
          searchInput.focus();
        });

        raDecOk.addEventListener('click', () => {
          const h = parseFloat(raHours.value);
          const m = parseFloat(raMinutes.value);
          const s = parseFloat(raSeconds.value);
          const d = parseFloat(decDegrees.value);
          const dm = parseFloat(decMinutes.value);
          const ds = parseFloat(decSeconds.value);

          if (isNaN(h) || isNaN(m) || isNaN(s) || isNaN(d) || isNaN(dm) || isNaN(ds)) {
            showToast({ message: t('modal.invalidCoordinates'), type: 'error', duration: 3000 });
            return;
          }
          if (h < 0 || h > 23 || m < 0 || m > 59 || s < 0 || s > 59) {
            showToast({ message: t('modal.invalidCoordinates'), type: 'error', duration: 3000 });
            return;
          }
          if (d < -89 || d > 89 || dm < 0 || dm > 59 || ds < 0 || ds > 59) {
            showToast({ message: t('modal.invalidCoordinates'), type: 'error', duration: 3000 });
            return;
          }

          const ra = (h + m / 60 + s / 3600) * 15;
          const sign = d < 0 ? -1 : 1;
          const dec = Math.abs(d) + dm / 60 + ds / 3600;
          const decDeg = sign * dec;

          if (ra < 0 || ra >= 360 || decDeg < -90 || decDeg > 90) {
            showToast({ message: t('modal.invalidCoordinates'), type: 'error', duration: 3000 });
            return;
          }

          selectRaDec(i, ra, decDeg);
        });

        const dropdown = document.createElement('div');
        dropdown.className = 'search-dropdown';
        dropdowns.push(dropdown);

        searchWrapper.appendChild(searchRow);
        searchWrapper.appendChild(raDecRow);
        searchWrapper.appendChild(dropdown);

        info.appendChild(status);
        info.appendChild(searchWrapper);

        entry.appendChild(markerDot);
        entry.appendChild(info);
        formSide.appendChild(entry);
        pointEntries.push(entry);

        // Search handler (async with debounce)
        let debounceTimer: ReturnType<typeof setTimeout> | null = null;
        searchInput.addEventListener('input', () => {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(async () => {
            const query = searchInput.value;
            if (!query || query.length < 1) {
              dropdown.innerHTML = '';
              dropdown.style.display = 'none';
              return;
            }
            const results = await searchStarsAPI(query);
            if (searchInput.value !== query) return;
            dropdown.innerHTML = '';
            if (results.length === 0) {
              dropdown.style.display = 'none';
              return;
            }
            dropdown.style.display = 'block';
            for (const result of results) {
              const item = document.createElement('div');
              item.className = 'search-item';
              item.innerHTML = `
                <span class="search-item-name">${result.label}</span>
                <span class="search-item-mag">mag ${result.mag.toFixed(1)}</span>
              `;
              item.addEventListener('click', () => {
                const star: Star = {
                  hip: result.hip,
                  ra: result.ra,
                  dec: result.dec,
                  mag: result.mag,
                  bv: result.bv,
                  name: result.name,
                  bayer: result.bayer,
                  flam: result.flam,
                  constellation: result.constellation,
                  desig: result.desig,
                };
                const displayName = result.label.split(' – ')[0].trim();
                selectStar(i, star, displayName);
                dropdown.style.display = 'none';
              });
              dropdown.appendChild(item);
            }
          }, 250);
        });

        searchInput.addEventListener('blur', () => {
          setTimeout(() => {
            dropdown.style.display = 'none';
          }, 200);
        });

        searchInput.addEventListener('focus', () => {
          if (searchInput.value.length > 0) {
            searchInput.dispatchEvent(new Event('input'));
          }
        });
      }

      // Footer: Validate (enabled at 2+ points) + Cancel
      const submitBtn = document.createElement('button');
      submitBtn.className = 'btn-confirm';
      submitBtn.textContent = t('modal.validate');
      submitBtn.disabled = true;
      formSide.appendChild(submitBtn);

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn-cancel';
      cancelBtn.textContent = t('modal.cancel');
      cancelBtn.addEventListener('click', () => closeModal());
      formSide.appendChild(cancelBtn);

      submitBtn.addEventListener('click', () => {
        const correspondences = points.filter((p) => isPointComplete(p)) as PhotoCorrespondence[];
        if (correspondences.length < 2) return;
        finish({ action: 'validate', correspondences });
      });

      body.appendChild(photoSide);
      body.appendChild(formSide);
      modal.appendChild(body);
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);

      // Load image
      const url = URL.createObjectURL(file);
      photoImg.onload = () => {
        naturalWidth = photoImg.naturalWidth;
        naturalHeight = photoImg.naturalHeight;
        URL.revokeObjectURL(url);
      };
      photoImg.src = url;

      // Markers on photo
      const markers: HTMLDivElement[] = [];

      // ── Zoom / pan ───────────────────────────────────────────────────────────
      zoom = createImageZoomPan(photoImg, photoContainer, { minScale: 1, maxScale: 5 });
      photoWrapper.appendChild(zoom.controls);

      function updateMarkerPositions() {
        markers.forEach((marker, idx) => {
          if (!marker || !points[idx]) return;
          const imgRect = photoImg.getBoundingClientRect();
          const cR = photoContainer.getBoundingClientRect();
          const displayX =
            imgRect.left - cR.left + (points[idx]!.photoX / naturalWidth) * imgRect.width;
          const displayY =
            imgRect.top - cR.top + (points[idx]!.photoY / naturalHeight) * imgRect.height;
          marker.style.left = `${displayX}px`;
          marker.style.top = `${displayY}px`;
        });
      }

      const updateCursor = () => {
        photoContainer.style.cursor = zoom!.getState().scale > 1 ? 'grab' : 'crosshair';
      };
      zoom.onTransformChange(() => {
        updateCursor();
        updateMarkerPositions();
      });
      photoContainer.addEventListener('pointerdown', () => {
        photoContainer.style.cursor = zoom!.getState().scale > 1 ? 'grabbing' : 'crosshair';
      });
      photoContainer.addEventListener('pointerup', updateCursor);
      photoContainer.addEventListener('pointercancel', updateCursor);
      updateCursor();

      photoContainer.addEventListener('click', (e) => {
        if (zoom!.wasDrag) return;
        if (activeIndex >= 3) return;

        const imgRect = photoImg.getBoundingClientRect();
        const relX = (e.clientX - imgRect.left) / imgRect.width;
        const relY = (e.clientY - imgRect.top) / imgRect.height;
        if (relX < 0 || relX > 1 || relY < 0 || relY > 1) return;

        const natX = relX * naturalWidth;
        const natY = relY * naturalHeight;
        const cR = photoContainer.getBoundingClientRect();
        placeMarker(activeIndex, e.clientX - cR.left, e.clientY - cR.top, natX, natY);
      });

      function placeMarker(idx: number, dispX: number, dispY: number, natX: number, natY: number) {
        if (markers[idx]) markers[idx].remove();

        const marker = document.createElement('div');
        marker.className = 'photo-marker';
        marker.style.left = `${dispX}px`;
        marker.style.top = `${dispY}px`;
        marker.style.backgroundColor = MARKER_COLORS[idx];
        marker.textContent = String(idx + 1);
        photoContainer.appendChild(marker);
        markers[idx] = marker;

        points[idx] = {
          pointIndex: idx,
          photoX: natX,
          photoY: natY,
          starHip: 0,
          starName: '',
        };

        const searchWrapper = pointEntries[idx].querySelector('.search-wrapper') as HTMLElement;
        searchWrapper.style.display = 'block';
        statusLabels[idx].textContent = t('modal.positionSet');
        searchInputs[idx].focus();

        updateActiveIndex();
      }

      function resetStarSelection(idx: number) {
        if (!points[idx]) return;
        points[idx]!.starHip = 0;
        points[idx]!.starName = '';
        points[idx]!.starRa = undefined;
        points[idx]!.starDec = undefined;
        searchInputs[idx].disabled = false;
        searchInputs[idx].value = '';
        if (pickBtns[idx]) pickBtns[idx].disabled = false;
        statusLabels[idx].textContent = t('modal.positionSet');
        statusLabels[idx].className = 'point-status';
        statusLabels[idx].onclick = null;
        pointEntries[idx].classList.remove('complete');
        updateActiveIndex();
        checkComplete();
        searchInputs[idx].focus();
      }

      function markStarComplete(idx: number) {
        statusLabels[idx].onclick = () => resetStarSelection(idx);
      }

      function selectStar(idx: number, star: Star, label: string) {
        if (!points[idx]) return;
        points[idx]!.starHip = star.hip;
        points[idx]!.starName = label;
        points[idx]!.starRa = undefined;
        points[idx]!.starDec = undefined;
        statusLabels[idx].textContent = label;
        statusLabels[idx].className = 'point-status point-complete';
        searchInputs[idx].value = label;
        searchInputs[idx].disabled = true;
        pointEntries[idx].classList.add('complete');
        if (pickBtns[idx]) pickBtns[idx].disabled = true;
        markStarComplete(idx);
        updateActiveIndex();
        checkComplete();
      }

      function selectRaDec(idx: number, ra: number, dec: number) {
        if (!points[idx]) return;
        points[idx]!.starHip = 0;
        points[idx]!.starRa = ra;
        points[idx]!.starDec = dec;
        const label = t('modal.raDecSet', { ra: ra.toFixed(2), dec: dec.toFixed(2) });
        points[idx]!.starName = label;
        statusLabels[idx].textContent = label;
        statusLabels[idx].className = 'point-status point-complete';
        searchInputs[idx].value = label;
        searchInputs[idx].disabled = true;
        pointEntries[idx].classList.add('complete');
        if (pickBtns[idx]) pickBtns[idx].disabled = true;
        markStarComplete(idx);
        updateActiveIndex();
        checkComplete();
      }

      function isPointComplete(p: PhotoCorrespondence | null): boolean {
        if (!p) return false;
        return p.starHip !== 0 || (p.starRa !== undefined && p.starDec !== undefined);
      }

      function updateActiveIndex() {
        for (let i = 0; i < 3; i++) {
          if (!isPointComplete(points[i])) {
            activeIndex = i;
            for (let j = 0; j < 3; j++) {
              if (j === i && (!points[j] || points[j]!.photoX === undefined)) {
                statusLabels[j].textContent = t('modal.clickPhoto');
              }
            }
            return;
          }
        }
        activeIndex = 3;
      }

      function checkComplete() {
        const completeCount = points.filter((p) => isPointComplete(p)).length;
        submitBtn.disabled = completeCount < 2;
      }
    });
  }

  /** Open manual placement mode: semi-transparent photo draggable on the map */
  openManualPlacement(
    file: File,
    initialMeta?: {
      originalName?: string;
      dsoIds: string[];
      labels: string[];
      pointsOfInterest?: PointOfInterest[];
      integrations?: PhotoIntegration[];
      observationDate?: string | null;
      notes: string;
    },
  ) {
    const view = this.getView();

    // Create preview img element
    const imgEl = document.createElement('img');
    imgEl.className = 'photo-overlay-img manual-placement-img';
    imgEl.style.opacity = '0.5';
    imgEl.style.pointerEvents = 'auto';
    imgEl.style.cursor = 'move';
    const objUrl = URL.createObjectURL(file);
    imgEl.src = objUrl;
    this.container.appendChild(imgEl);

    let naturalWidth = 0;
    let naturalHeight = 0;

    imgEl.onload = () => {
      naturalWidth = imgEl.naturalWidth;
      naturalHeight = imgEl.naturalHeight;
      redraw(this.getView());
    };

    // Placement state
    const placement: ManualPlacement = {
      centerRa: 0,
      centerDec: 60,
      rotationDeg: 0,
      projPerPx: 0.002,
      mirrorX: false,
      mirrorY: false,
    };

    // Initialize to current map center
    const initView = this.getView();
    const centerProj = { x: initView.centerX, y: initView.centerY };
    const centerSky = unproject(centerProj.x, centerProj.y);
    placement.centerRa = centerSky.ra;
    placement.centerDec = centerSky.dec;
    placement.projPerPx = (1 / initView.scale) * 0.5;

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'manual-toolbar';
    toolbar.innerHTML = `
      <span class="manual-toolbar-label">${t('manual.modeLabel')}</span>
      <label class="manual-toolbar-item">
        ${t('manual.rotation')}&nbsp;
        <input type="range" min="-180" max="180" value="0" step="1" class="manual-rotation-range">
        <span class="manual-rotation-val">0°</span>
      </label>
      <label class="manual-toolbar-item">
        ${t('manual.photoZoom')}&nbsp;
        <input type="range" min="-6" max="2" value="0" step="0.1" class="manual-zoom-range">
      </label>
      <button class="manual-mirror-btn" data-axis="x">${t('manual.mirrorX')}</button>
      <button class="manual-mirror-btn" data-axis="y">${t('manual.mirrorY')}</button>
      <div class="manual-toolbar-buttons">
        <button class="btn-confirm">${t('manual.validate')}</button>
        <button class="btn-cancel">${t('manual.cancel')}</button>
      </div>
    `;
    document.body.appendChild(toolbar);

    const rotationRange = toolbar.querySelector('.manual-rotation-range') as HTMLInputElement;
    const rotationVal = toolbar.querySelector('.manual-rotation-val') as HTMLSpanElement;
    const zoomRange = toolbar.querySelector('.manual-zoom-range') as HTMLInputElement;
    const validateBtn = toolbar.querySelector('.btn-confirm') as HTMLButtonElement;
    const cancelBtn = toolbar.querySelector('.btn-cancel') as HTMLButtonElement;

    const redraw = (v: ViewState) => {
      if (!naturalWidth || !naturalHeight) return;
      applyManualTransform(imgEl, placement, v, naturalWidth, naturalHeight);
    };

    // Hook into view changes via SkyMap's public setOnViewChange
    if (this.skyMap) {
      const origOnViewChange = (this.skyMap as any)['onViewChange'] as (() => void) | null;
      this.skyMap.setOnViewChange(() => {
        origOnViewChange?.();
        redraw(this.getView());
      });
    }

    // Drag on the image
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragStartRa = placement.centerRa;
    let dragStartDec = placement.centerDec;

    imgEl.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dragStartRa = placement.centerRa;
      dragStartDec = placement.centerDec;
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const v = this.getView();
      const dx = (e.clientX - dragStartX) / v.scale;
      const dy = (e.clientY - dragStartY) / v.scale;
      // Current center in projection
      const startProj = project(dragStartRa, dragStartDec);
      const newProj = { x: startProj.x + dx, y: startProj.y - dy };
      const newSky = unproject(newProj.x, newProj.y);
      placement.centerRa = newSky.ra;
      placement.centerDec = newSky.dec;
      redraw(v);
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
    });

    // Scroll on image → zoom
    imgEl.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        placement.projPerPx *= factor;
        redraw(this.getView());
      },
      { passive: false },
    );

    // Rotation slider
    rotationRange.addEventListener('input', () => {
      placement.rotationDeg = parseFloat(rotationRange.value);
      rotationVal.textContent = `${placement.rotationDeg}°`;
      redraw(this.getView());
    });

    // Zoom slider (log scale)
    zoomRange.addEventListener('input', () => {
      const baseScale = (1 / this.getView().scale) * 0.5;
      placement.projPerPx = baseScale * Math.pow(2, parseFloat(zoomRange.value));
      redraw(this.getView());
    });

    // Mirror buttons
    const mirrorBtnX = toolbar.querySelector(
      '.manual-mirror-btn[data-axis="x"]',
    ) as HTMLButtonElement;
    const mirrorBtnY = toolbar.querySelector(
      '.manual-mirror-btn[data-axis="y"]',
    ) as HTMLButtonElement;

    mirrorBtnX.addEventListener('click', () => {
      placement.mirrorX = !placement.mirrorX;
      mirrorBtnX.classList.toggle('active', placement.mirrorX);
      redraw(this.getView());
    });

    mirrorBtnY.addEventListener('click', () => {
      placement.mirrorY = !placement.mirrorY;
      mirrorBtnY.classList.toggle('active', placement.mirrorY);
      redraw(this.getView());
    });

    const cleanup = () => {
      imgEl.remove();
      toolbar.remove();
      URL.revokeObjectURL(objUrl);
    };

    // Cancel
    cancelBtn.addEventListener('click', cleanup);

    // Validate
    validateBtn.addEventListener('click', async () => {
      if (!naturalWidth || !naturalHeight) return;
      validateBtn.disabled = true;
      validateBtn.textContent = t('manual.processing');

      try {
        console.log('[Manual Validation] Placement:', placement);
        console.log('[Manual Validation] Photo dimensions:', naturalWidth, 'x', naturalHeight);

        const correspondences = buildSyntheticCorrespondences(
          placement,
          naturalWidth,
          naturalHeight,
          this.getView(),
        );
        if (!correspondences) {
          showToast({ message: t('manual.noStarsFound'), type: 'error', duration: 5000 });
          validateBtn.disabled = false;
          validateBtn.textContent = t('manual.validate');
          return;
        }

        console.log('[Manual Validation] Generated correspondences:', correspondences);

        // Compute DSOs from placement geometry if not already provided
        let metaToUpload = initialMeta;
        if (!metaToUpload) {
          metaToUpload = {
            dsoIds: [],
            labels: [],
            pointsOfInterest: [],
            integrations: [],
            observationDate: null,
            notes: '',
          };
        }
        if (metaToUpload.dsoIds.length === 0) {
          const centerProj2 = project(placement.centerRa, placement.centerDec);
          const rotRad2 = (placement.rotationDeg * Math.PI) / 180;
          const mx2 = placement.mirrorX ? -1 : 1;
          const my2 = placement.mirrorY ? -1 : 1;
          const cx2 = naturalWidth / 2;
          const cy2 = naturalHeight / 2;
          const cosR2 = Math.cos(rotRad2) * placement.projPerPx;
          const sinR2 = Math.sin(rotRad2) * placement.projPerPx;
          const a2 = cosR2 * mx2;
          const b2 = sinR2 * mx2;
          const c2 = -sinR2 * my2;
          const d2 = cosR2 * my2;
          const aff = {
            a: a2,
            b: b2,
            c: c2,
            d: d2,
            e: centerProj2.x - a2 * cx2 - c2 * cy2,
            f: centerProj2.y - b2 * cx2 - d2 * cy2,
          };
          metaToUpload = {
            ...metaToUpload,
            dsoIds: findDSOsInImage(aff, naturalWidth, naturalHeight).map((d) => d.id),
          };
        }

        // Compute the manual CSS matrix for comparison
        const view = this.getView();
        const centerProj = project(placement.centerRa, placement.centerDec);
        const centerCanvas = toCanvas(centerProj.x, centerProj.y, view);
        const pxPerPx = placement.projPerPx * view.scale;
        const rotRad = (placement.rotationDeg * Math.PI) / 180;
        const mx = placement.mirrorX ? -1 : 1;
        const my = placement.mirrorY ? -1 : 1;
        const cx = naturalWidth / 2;
        const cy = naturalHeight / 2;
        const cosR = Math.cos(rotRad) * pxPerPx;
        const sinR = Math.sin(rotRad) * pxPerPx;
        const manualMatrix = {
          a: cosR * mx,
          b: sinR * mx,
          c: -sinR * my,
          d: cosR * my,
          e: centerCanvas.x - cosR * mx * cx - -sinR * my * cy,
          f: centerCanvas.y - sinR * mx * cx - cosR * my * cy,
        };
        console.log('[Manual Validation] Manual CSS matrix:', manualMatrix, 'at view:', view);
        (window as any).__manualMatrix = manualMatrix; // Store for comparison

        const photo = await uploadPhoto(file, correspondences, placement, undefined, {
          ...metaToUpload,
          observationDate: metaToUpload.observationDate ?? null,
          displayName: initialMeta?.originalName || stripExtension(file.name),
        });
        cleanup();
        this.addPhotoToMap(photo);
        this.fireOnPhotosChanged();
      } catch (err: any) {
        showToast({
          message: t('modal.uploadError', { message: err.message }),
          type: 'error',
          duration: 5000,
        });
        validateBtn.disabled = false;
        validateBtn.textContent = t('manual.validate');
      }
    });
  }

  /** Open repositioning mode for an existing photo */
  startRepositioning(photoId: string) {
    const placed = this.placedPhotos.find((p) => p.photo.id === photoId);
    if (!placed) return;

    const photo = placed.photo;
    const imgEl = placed.imgEl;
    const view = this.getView();

    // Hide the original photo during repositioning
    imgEl.style.display = 'none';

    // Create a preview element
    const previewEl = document.createElement('img');
    previewEl.className = 'photo-overlay-img manual-placement-img';
    previewEl.style.opacity = '0.5';
    previewEl.style.pointerEvents = 'auto';
    previewEl.style.cursor = 'move';
    previewEl.src = imgEl.src;
    this.container.appendChild(previewEl);

    const naturalWidth = imgEl.naturalWidth;
    const naturalHeight = imgEl.naturalHeight;

    // Initialize placement from photo's current state
    let placement: ManualPlacement;

    if (photo.manualPlacement) {
      // Use existing manual placement
      placement = { ...photo.manualPlacement };
    } else {
      // Extract placement from the current CSS transform matrix
      // This ensures the repositioned photo starts exactly where it currently is
      const matrix = extractMatrixFromTransform(imgEl.style.transform);
      if (matrix) {
        placement = derivePlacementFromMatrix(matrix, view, naturalWidth, naturalHeight);
        // Round rotation to nearest degree for cleaner UI
        placement.rotationDeg = Math.round(placement.rotationDeg);
      } else {
        // Fallback: derive from correspondences (shouldn't normally happen)
        placement = derivePlacementFromCorrespondences(photo, naturalWidth, naturalHeight);
        placement.rotationDeg = Math.round(placement.rotationDeg);
      }
    }

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'manual-toolbar';
    toolbar.innerHTML = `
      <span class="manual-toolbar-label">${t('manual.modeLabel')}</span>
      <label class="manual-toolbar-item">
        ${t('manual.rotation')}&nbsp;
        <input type="range" min="-180" max="180" value="${placement.rotationDeg}" step="1" class="manual-rotation-range">
        <span class="manual-rotation-val">${placement.rotationDeg}°</span>
      </label>
      <label class="manual-toolbar-item">
        ${t('manual.photoZoom')}&nbsp;
        <input type="range" min="-6" max="2" value="0" step="0.1" class="manual-zoom-range">
      </label>
      <button class="manual-mirror-btn ${placement.mirrorX ? 'active' : ''}" data-axis="x">${t('manual.mirrorX')}</button>
      <button class="manual-mirror-btn ${placement.mirrorY ? 'active' : ''}" data-axis="y">${t('manual.mirrorY')}</button>
      <div class="manual-toolbar-buttons">
        <button class="btn-confirm">${t('manual.validate')}</button>
        <button class="btn-cancel">${t('manual.cancel')}</button>
      </div>
    `;
    document.body.appendChild(toolbar);

    const rotationRange = toolbar.querySelector('.manual-rotation-range') as HTMLInputElement;
    const rotationVal = toolbar.querySelector('.manual-rotation-val') as HTMLSpanElement;
    const zoomRange = toolbar.querySelector('.manual-zoom-range') as HTMLInputElement;
    const validateBtn = toolbar.querySelector('.btn-confirm') as HTMLButtonElement;
    const cancelBtn = toolbar.querySelector('.btn-cancel') as HTMLButtonElement;

    const redraw = (v: ViewState) => {
      // Use natural dimensions (actual loaded image size) for consistency with extraction
      applyManualTransform(previewEl, placement, v, naturalWidth, naturalHeight);
    };

    // Initial draw
    redraw(view);

    // Hook into view changes
    if (this.skyMap) {
      const origOnViewChange = (this.skyMap as any)['onViewChange'] as (() => void) | null;
      this.skyMap.setOnViewChange(() => {
        origOnViewChange?.();
        redraw(this.getView());
      });
    }

    // Drag on the image
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragStartRa = placement.centerRa;
    let dragStartDec = placement.centerDec;

    previewEl.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dragStartRa = placement.centerRa;
      dragStartDec = placement.centerDec;
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const v = this.getView();
      const dx = (e.clientX - dragStartX) / v.scale;
      const dy = (e.clientY - dragStartY) / v.scale;
      const startProj = project(dragStartRa, dragStartDec);
      const newProj = { x: startProj.x + dx, y: startProj.y - dy };
      const newSky = unproject(newProj.x, newProj.y);
      placement.centerRa = newSky.ra;
      placement.centerDec = newSky.dec;
      redraw(v);
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
    });

    // Scroll on image → zoom
    previewEl.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        placement.projPerPx *= factor;
        redraw(this.getView());
      },
      { passive: false },
    );

    // Rotation slider
    rotationRange.addEventListener('input', () => {
      placement.rotationDeg = parseFloat(rotationRange.value);
      rotationVal.textContent = `${placement.rotationDeg}°`;
      redraw(this.getView());
    });

    // Zoom slider (log scale)
    const baseScale = placement.projPerPx / ((1 / view.scale) * 0.5);
    const initialZoomValue = Math.log2(baseScale);
    zoomRange.value = String(initialZoomValue);
    zoomRange.addEventListener('input', () => {
      const baseScale = (1 / this.getView().scale) * 0.5;
      placement.projPerPx = baseScale * Math.pow(2, parseFloat(zoomRange.value));
      redraw(this.getView());
    });

    // Mirror buttons
    const mirrorBtnX = toolbar.querySelector(
      '.manual-mirror-btn[data-axis="x"]',
    ) as HTMLButtonElement;
    const mirrorBtnY = toolbar.querySelector(
      '.manual-mirror-btn[data-axis="y"]',
    ) as HTMLButtonElement;

    mirrorBtnX.addEventListener('click', () => {
      placement.mirrorX = !placement.mirrorX;
      mirrorBtnX.classList.toggle('active', placement.mirrorX);
      redraw(this.getView());
    });

    mirrorBtnY.addEventListener('click', () => {
      placement.mirrorY = !placement.mirrorY;
      mirrorBtnY.classList.toggle('active', placement.mirrorY);
      redraw(this.getView());
    });

    const cleanup = () => {
      previewEl.remove();
      toolbar.remove();
      imgEl.style.display = '';
    };

    // Cancel
    cancelBtn.addEventListener('click', cleanup);

    // Validate
    validateBtn.addEventListener('click', async () => {
      if (!naturalWidth || !naturalHeight) return;
      validateBtn.disabled = true;
      validateBtn.textContent = t('manual.processing');

      try {
        await updatePhotoManualPlacement(photoId, placement);

        // Update local photo object
        photo.manualPlacement = placement;

        // Clean up preview
        cleanup();

        // Reapply transform with new placement
        this.applyTransform(placed, this.getView());

        showToast({
          message: t('photos.repositioned', { name: photo.originalName }),
          type: 'info',
          duration: 3000,
        });
      } catch (err: any) {
        showToast({ message: t('errors.updatePhoto'), type: 'error', duration: 5000 });
        validateBtn.disabled = false;
        validateBtn.textContent = t('manual.validate');
      }
    });
  }
}

/** Apply a manual placement's CSS transform to imgEl (matrix math in photo-placement.ts). */
function applyManualTransform(
  imgEl: HTMLImageElement,
  placement: ManualPlacement,
  view: ViewState,
  natW: number,
  natH: number,
): void {
  imgEl.style.transform = affineToCSS(computeManualMatrix(placement, view, natW, natH));
}
