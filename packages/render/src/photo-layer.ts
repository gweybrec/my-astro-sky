/**
 * The photo layer of the sky map: each placed photo is an `<img>` of a container laid over the canvas, moved by a CSS
 * matrix fitted to its star correspondences (or its manual placement) at the current view. It holds what the photos
 * look like and where they are; where their files are, and what to tell the user when one cannot be placed, come
 * from the hooks of the app.
 */
import type {
  Photo,
  Point,
  ViewState,
  ManualPlacement,
  PoiCategory,
  AffineMatrix,
} from '@myastrosky/core/types';
import { toCanvas, borderRadiusPU, getProjectionGeneration } from '@myastrosky/core/projection';
import { MEDIUM_SIZE, THUMB_SIZE } from '@myastrosky/core/services/photos';
import { affineToCSS } from '@myastrosky/core/affine';
import { logDebug } from '@myastrosky/core/platform/log';
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
  manualPlacementCentroid,
  computeManualMatrix,
} from '@myastrosky/core/photo-placement';
import type { PhotoCanvasQuad } from '@myastrosky/core/photo-draw-order';
import { resolveCategory, isPoiVisible } from '@myastrosky/core/poi';
import { hasPosition, type SkyPoiPin } from './poi-pins';

/** A (possibly relative) address as an `<img>`'s `src` reports it. Kept: parsing it for every photo on every move of
 * the view showed in phone traces. */
const absoluteUrls = new Map<string, string>();
const absoluteUrl = (url: string): string => {
  let abs = absoluteUrls.get(url);
  if (abs === undefined) {
    abs = new URL(url, document.baseURI).href;
    absoluteUrls.set(url, abs);
  }
  return abs;
};

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
  /** The full picture being decoded off-screen before it replaces the thumbnail (see showSrc). */
  pendingSrc?: string;
}

/** What the layer asks of its app. */
export interface PhotoLayerHooks {
  /** The map to redraw when the photos' pins or visibility change. */
  skyMap?: { requestRender(): void } | null;
  /** The address of a stored photo file (or of its thumbnail). */
  photoUrl(filename: string): string;
  /** A photo could not be placed (its correspondences do not fit a transform). Called once per photo. */
  onPlacementError?(photo: Photo): void;
  /** A loaded photo's size is not the one stored with it. */
  onDimensionMismatch?(photo: Photo, expected: string, actual: string): void;
}

export class PhotoLayer {
  protected container: HTMLDivElement;
  protected placedPhotos: PlacedPhoto[] = [];
  protected getView: () => ViewState;
  protected skyMap: { requestRender(): void } | null;
  protected hooks: PhotoLayerHooks;
  protected affineErrorShown = new Set<string>();
  protected defaultOpacity = 1.0;
  protected borderRadiusPU = Infinity; // projection-unit radius of the border circle
  protected showPhotos = true; // Global toggle for all photos
  protected visibleLabels: { [label: string]: boolean } = {};
  protected visiblePois: { [poiKey: string]: boolean } = {};
  protected showPois = true; // "Show points of interest" — pins over photos
  protected poiCategories: PoiCategory[] = [];

  constructor(container: HTMLDivElement, getView: () => ViewState, hooks: PhotoLayerHooks) {
    this.container = container;
    this.getView = getView;
    this.hooks = hooks;
    this.skyMap = hooks.skyMap ?? null;
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

  protected onPhotosChangedCallbacks: Array<() => void> = [];

  setOnPhotosChanged(cb: () => void) {
    this.onPhotosChangedCallbacks = [cb];
  }

  addOnPhotosChanged(cb: () => void) {
    this.onPhotosChangedCallbacks.push(cb);
  }

  setDefaultOpacity(v: number) {
    this.defaultOpacity = v;
  }

  protected fireOnPhotosChanged() {
    for (const cb of this.onPhotosChangedCallbacks) {
      cb();
    }
  }

  /** True when the photo passes the current label filter (no filter ⇒ allowed). */
  protected isLabelAllowed(placed: PlacedPhoto): boolean {
    return labelAllowed(placed.photo, this.visibleLabels);
  }

  protected applyPhotoVisibility() {
    for (const placed of this.placedPhotos) {
      const shouldDisplay = this.showPhotos && placed.visible && this.isLabelAllowed(placed);
      placed.imgEl.style.display = shouldDisplay ? 'block' : 'none';
    }
    // POI pins are drawn on the sky map's overlay canvas — repaint so they follow.
    this.skyMap?.requestRender();
  }

  /**
   * Positioned POIs (e.g. identified supernovae) of every photo currently shown on
   * the map, for the sky map's pin pass: only while "Show points of interest" is on,
   * only for photos that are themselves displayed, and each POI shown unless unchecked
   * in the panel's POI dropdown (checked = shown, like labels; it never hides photos).
   */
  getPoiPins(): SkyPoiPin[] {
    const pins: SkyPoiPin[] = [];
    if (!this.showPhotos || !this.showPois) return pins;
    for (const placed of this.placedPhotos) {
      if (!placed.visible || placed.pendingDelete || placed.borderHidden) continue;
      if (!this.isLabelAllowed(placed)) continue;
      for (const poi of placed.photo.pointsOfInterest ?? []) {
        if (!hasPosition(poi)) continue;
        if (!isPoiVisible(poi, this.poiCategories, this.visiblePois)) continue;
        pins.push({
          ra: poi.ra,
          dec: poi.dec,
          label: poi.name,
          color: resolveCategory(poi.categoryId, this.poiCategories).color,
        });
      }
    }
    return pins;
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

  /** Sky-map POI dropdown state: `poiKey` → false hides that pin (absent ⇒ shown). */
  setVisiblePois(visible: { [poiKey: string]: boolean }) {
    this.visiblePois = visible || {};
    this.skyMap?.requestRender();
  }

  /** "Show points of interest" toggle: pins only — photos are unaffected. */
  setShowPois(show: boolean) {
    this.showPois = show;
    this.skyMap?.requestRender();
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

  /**
   * Recalculate all photo transforms (call on zoom/pan/resize). `moving`: the view is moving, so no full picture is
   * newly loaded (see showPictureFor) until the next call without it, made once the view has stopped.
   */
  updateTransforms(moving = false) {
    this.moving = moving;
    this.placeAll();
  }

  /**
   * Set by updateTransforms(true) until a call without it: also a photo placed when its picture has loaded, during
   * the gesture, loads no full picture.
   */
  private moving = false;

  private placeAll() {
    const view = this.getView();
    const gen = getProjectionGeneration();

    // Clip the photo layer to the visible sky circle so a photo whose centroid sits
    // just inside the rim can't bulge past the edge into the black. Mirrors the canvas
    // ctx.clip() in SkyMap.render(): centre is the projected pole, radius is the border
    // radius in screen px. Centroid-only culling above hides photos whose *centre* is
    // outside; this clips the *body* of the ones kept. borderRadiusPU is Infinity when
    // no border is set → no clip.
    if (isFinite(this.borderRadiusPU)) {
      const origin = toCanvas(0, 0, view);
      const r = this.borderRadiusPU * view.scale;
      this.container.style.clipPath = `circle(${r}px at ${origin.x}px ${origin.y}px)`;
    } else {
      this.container.style.clipPath = 'none';
    }

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
    this.updatePhotosData([updated]);
  }

  /**
   * Same as updatePhotoData for a whole batch, firing onPhotosChanged **once** —
   * a per-photo call would trigger one full map re-render + gallery reload each
   * (see the batch label/setup editor).
   */
  updatePhotosData(updated: Photo[]): void {
    let changed = false;
    for (const photo of updated) {
      const idx = this.placedPhotos.findIndex((p) => p.photo.id === photo.id);
      if (idx >= 0) {
        // Replace with a new object so Vue's shallowRef detects the change via reference equality
        this.placedPhotos[idx] = { ...this.placedPhotos[idx], photo };
        changed = true;
      }
    }
    if (changed) this.fireOnPhotosChanged();
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
    this.skyMap?.requestRender();
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

  protected reorderDOM() {
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

  /** Remove specific photos from the in-memory overlay without calling the API (call bulk API first). */
  removePhotosFromMap(ids: string[]) {
    const idSet = new Set(ids);
    const removed = this.placedPhotos.filter((p) => idSet.has(p.photo.id));
    removed.forEach((p) => p.imgEl.remove());
    this.placedPhotos = this.placedPhotos.filter((p) => !idSet.has(p.photo.id));
    if (removed.length > 0) this.fireOnPhotosChanged();
  }

  /**
   * Stops the downloads of the pictures that have not loaded yet (`paused`), and starts them again. The phone pauses
   * them while its map's tab is not shown, so the tab shown gets the connection and the decoding to itself.
   */
  setLoadingPaused(paused: boolean) {
    for (const placed of this.placedPhotos) {
      const { imgEl } = placed;
      // A full picture still decoding off-screen is not swapped in; the next transform asks again.
      if (paused) placed.pendingSrc = undefined;
      if (paused && imgEl.getAttribute('src') && !imgEl.complete) {
        imgEl.dataset.pausedSrc = imgEl.getAttribute('src')!;
        imgEl.removeAttribute('src');
      } else if (!paused && imgEl.dataset.pausedSrc) {
        imgEl.src = imgEl.dataset.pausedSrc;
        delete imgEl.dataset.pausedSrc;
      }
    }
  }

  /** Remove all photos from the in-memory overlay without calling the API. */
  clearAllPhotos() {
    this.placedPhotos.forEach((p) => p.imgEl.remove());
    this.placedPhotos = [];
    this.fireOnPhotosChanged();
  }

  protected addPhotoToMap(photo: Photo) {
    // Check if photo already exists
    const existing = this.placedPhotos.find((p) => p.photo.id === photo.id);
    if (existing) {
      logDebug('addPhotoToMap', `Photo ${photo.originalName} already exists, skipping duplicate`);
      return;
    }

    this.placedPhotos.push(this.placePhotoImage(photo, this.defaultOpacity, null));
  }

  /**
   * A photo whose picture changed (turned a quarter): its new picture takes the old one's place, and the photo keeps
   * its place in the draw order, its opacity and whether it is shown.
   */
  replacePhoto(updated: Photo): void {
    const idx = this.placedPhotos.findIndex((p) => p.photo.id === updated.id);
    if (idx < 0) return;
    const old = this.placedPhotos[idx];
    const placed = this.placePhotoImage(updated, old.opacity, old.imgEl);
    placed.visible = old.visible;
    placed.borderHidden = old.borderHidden;
    if (!old.visible) placed.imgEl.style.display = 'none';
    old.imgEl.remove();
    this.placedPhotos[idx] = placed;
    this.fireOnPhotosChanged();
  }

  /** The picture of a photo on the map, before `before` in the draw order (last without it). */
  private placePhotoImage(
    photo: Photo,
    opacity: number,
    before: HTMLImageElement | null,
  ): PlacedPhoto {
    const img = document.createElement('img');
    // A photo starts with its thumbnail: the size switch in applyTransform loads a larger picture once the photo shows
    // large. Starting with the full picture downloaded and decoded every one at start, only to swap most of them for
    // their thumbnails (44 full pictures on the phone for 42 shown as thumbnails).
    img.src = this.hooks.photoUrl(photo.thumbFilename || photo.filename);
    img.className = 'photo-overlay-img';
    img.draggable = false;
    img.style.visibility = 'hidden'; // Hide until loaded
    // Pin to full-image dims: affine matrix is in full-image pixel space; thumbnail LOD src swaps must not change the coordinate space.
    img.style.width = `${photo.width}px`;
    img.style.height = `${photo.height}px`;
    this.container.insertBefore(img, before);

    img.style.opacity = String(opacity);
    const placed: PlacedPhoto = {
      photo,
      imgEl: img,
      visible: true,
      opacity,
      borderHidden: false,
      viewportCulled: false,
      projCentroid: null,
      projHalfDiag: 0,
      projGen: -1,
    };

    img.onload = () => {
      // The photo as the map has it now: updatePhotosData replaces its entry (a medium copy made since, a repaired
      // size), and placed from the old one it would choose its picture without the copy.
      const live = this.placedPhotos.find((p) => p.imgEl === img) ?? placed;
      const { photo } = live;
      // Only validate dimensions for the full-resolution image. The LOD swap loads a 400px
      // thumbnail (server/index.ts) which is intentionally smaller, so assert dims only when
      // the currently loaded src is the full image.
      const isFullImage = img.src === absoluteUrl(this.hooks.photoUrl(photo.filename));
      if (isFullImage && (img.naturalWidth !== photo.width || img.naturalHeight !== photo.height)) {
        this.hooks.onDimensionMismatch?.(
          photo,
          `${photo.width}×${photo.height}`,
          `${img.naturalWidth}×${img.naturalHeight}`,
        );
      }

      img.style.visibility = 'visible';
      this.applyTransform(live, this.getView());
    };
    return placed;
  }

  protected applyTransform(placed: PlacedPhoto, view: ViewState) {
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
      const matrix = computeManualMatrix(photo.manualPlacement, view, photo.width, photo.height);
      imgEl.style.transform = affineToCSS(matrix);
      this.showPictureFor(placed, matrix);
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
      this.showPictureFor(placed, matrix);
    } catch {
      imgEl.style.display = 'none';
      if (!this.affineErrorShown.has(photo.id)) {
        this.affineErrorShown.add(photo.id);
        this.hooks.onPlacementError?.(photo);
      }
    }
  }

  /**
   * Shows the picture that suits the photo's size on screen (`matrix`: photo pixels to page pixels). With a
   * medium-sized copy, by screen pixels along the longer side: the thumbnail up to its own size, the copy up to its
   * size, the full picture beyond, so no picture is shown stretched and the full one only when its detail shows.
   * Without one, as before copies existed: the thumbnail below 300 page pixels wide, else the full picture.
   * While the view moves, a full picture already shown stays, and with a copy none is newly loaded: the copy
   * stands in until the view stops. Without one the full picture loads as at rest (decoded off-screen, see showSrc):
   * the thumbnail would show stretched for the whole gesture.
   */
  private showPictureFor(placed: PlacedPhoto, matrix: AffineMatrix): void {
    const { photo, imgEl } = placed;
    // A paused picture is loaded again by setLoadingPaused.
    if ((!photo.thumbFilename && !photo.mediumFilename) || imgEl.dataset.pausedSrc) return;
    if (this.moving && imgEl.src === absoluteUrl(this.hooks.photoUrl(photo.filename))) return;
    const scale = Math.hypot(matrix.a, matrix.b);
    let name: string;
    if (photo.mediumFilename) {
      const screenPx = scale * Math.max(photo.width, photo.height) * (window.devicePixelRatio || 1);
      if (photo.thumbFilename && screenPx <= THUMB_SIZE) name = photo.thumbFilename;
      else name = screenPx <= MEDIUM_SIZE ? photo.mediumFilename : photo.filename;
    } else {
      name = scale * photo.width < 300 ? photo.thumbFilename! : photo.filename;
    }
    if (this.moving && name === photo.filename && photo.mediumFilename) name = photo.mediumFilename;
    const src = this.hooks.photoUrl(name);
    if (imgEl.src === absoluteUrl(src)) placed.pendingSrc = undefined;
    else this.showSrc(placed, src, name !== photo.thumbFilename);
  }

  /**
   * Shows `src` in the photo's picture. A medium or full picture is decoded off-screen first
   * and swapped in once ready: set straight on the visible picture, the screen showed no new
   * frame of the map until it was decoded (~200 ms for a 24 MP photo on a phone). The
   * smaller picture stays meanwhile, and a size change before the decode ends drops the swap.
   */
  private showSrc(placed: PlacedPhoto, src: string, decodeFirst: boolean): void {
    if (!decodeFirst) {
      placed.pendingSrc = undefined;
      placed.imgEl.src = src;
      return;
    }
    if (placed.pendingSrc === src) return;
    placed.pendingSrc = src;
    const offscreen = new Image();
    offscreen.src = src;
    // On a failed decode the visible picture loads it anyway, so its load/error handling runs as before.
    const swap = () => {
      if (placed.pendingSrc !== src) return;
      placed.pendingSrc = undefined;
      placed.imgEl.src = src;
    };
    offscreen.decode().then(swap, swap);
  }
}

/** Apply a manual placement's CSS transform to imgEl (matrix math in photo-placement.ts). */
export function applyManualTransform(
  imgEl: HTMLImageElement,
  placement: ManualPlacement,
  view: ViewState,
  natW: number,
  natH: number,
): void {
  imgEl.style.transform = affineToCSS(computeManualMatrix(placement, view, natW, natH));
}
