/**
 * Pins for points of interest that carry a sky position (e.g. an identified
 * supernova): where they land on a photo, and how they are drawn — the
 * `poi-supernova` icon's 8 rays without its centre dot, so the object itself
 * stays visible in the middle of the marker.
 *
 * Shared by the gallery detail overlay (photo pixels) and the sky map overlay
 * (canvas pixels); both call {@link drawPoiPin}.
 */
import type { AffineMatrix, PointOfInterest } from './types';
import { applyAffine, invertAffine } from './affine';
import { project } from './projection';
import { placeLabel, type Rect, type Size } from './dso-label-placement';

/** A POI known to have a sky position. */
export type PositionedPoi = PointOfInterest & { ra: number; dec: number };

export function hasPosition(poi: PointOfInterest): poi is PositionedPoi {
  return (
    typeof poi.ra === 'number' &&
    typeof poi.dec === 'number' &&
    Number.isFinite(poi.ra) &&
    Number.isFinite(poi.dec)
  );
}

/** A positioned POI to pin on the sky map (above the photo layer). */
export interface SkyPoiPin {
  ra: number;
  dec: number;
  label: string;
  color: string;
}

/** A positioned POI placed on a photo, in photo pixels. */
export interface PhotoPoiPin {
  poi: PositionedPoi;
  x: number;
  y: number;
}

/** Positioned POIs that fall inside the photo, in photo pixels. */
export function poiPinsInImage(
  pois: PointOfInterest[],
  photoToProj: AffineMatrix,
  width: number,
  height: number,
): PhotoPoiPin[] {
  const inv = invertAffine(photoToProj);
  if (!inv) return [];
  const pins: PhotoPoiPin[] = [];
  for (const poi of pois) {
    if (!hasPosition(poi)) continue;
    const p = applyAffine(inv, project(poi.ra, poi.dec));
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.x < 0 || p.x > width || p.y < 0 || p.y > height) continue;
    pins.push({ poi, x: p.x, y: p.y });
  }
  return pins;
}

/** Inner/outer ray radius ratio of `icons/poi-supernova.svg` (rays span r = 6.2 → 9.6). */
const RAY_INNER_RATIO = 6.2 / 9.6;
const HALO_COLOR = 'rgba(0, 0, 0, 0.55)';

/**
 * Draws the 8-ray starburst centred on (x, y): `outerR` is the rays' tip radius.
 * A dark halo under the coloured rays keeps them legible over a bright galaxy core.
 */
export function drawPoiPin(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  outerR: number,
  color: string,
  lineWidth = Math.max(1.5, outerR / 5),
): void {
  const innerR = outerR * RAY_INNER_RATIO;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    ctx.moveTo(x + innerR * cos, y + innerR * sin);
    ctx.lineTo(x + outerR * cos, y + outerR * sin);
  }
  ctx.strokeStyle = HALO_COLOR;
  ctx.lineWidth = lineWidth + 2;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  ctx.restore();
}

/** On-screen tip radius of a pin on the photo overlay (fixed, like the label size). */
export const PHOTO_PIN_RADIUS_PX = 14;
const PIN_LABEL_HEIGHT_PX = 13;
const PIN_LABEL_GAP_PX = 4;

export interface PoiPinOverlayItem {
  label: string;
  color: string;
  screenX: number;
  screenY: number;
  labelBox: Rect;
}

/**
 * Lays out pin labels in image-relative CSS px (same space as
 * `computePhotoDsoOverlayLayout`), avoiding the boxes already taken by DSO labels
 * (`occupied`) and clamped to the visible `viewport`.
 */
export function computePoiPinLayout(
  pins: PhotoPoiPin[],
  dispScale: number,
  colorFor: (poi: PositionedPoi) => string,
  measureLabelWidth: (text: string) => number,
  viewport: Rect,
  occupied: Rect[] = [],
): PoiPinOverlayItem[] {
  const taken = [...occupied];
  return pins.map((pin) => {
    const screenX = pin.x * dispScale;
    const screenY = pin.y * dispScale;
    const size: Size = { width: measureLabelWidth(pin.poi.name), height: PIN_LABEL_HEIGHT_PX };
    const clearance = { x: PHOTO_PIN_RADIUS_PX, y: PHOTO_PIN_RADIUS_PX };
    const box = clampRect(
      placeLabel({ x: screenX, y: screenY }, clearance, size, PIN_LABEL_GAP_PX, taken),
      viewport,
    );
    taken.push(box);
    return { label: pin.poi.name, color: colorFor(pin.poi), screenX, screenY, labelBox: box };
  });
}

function clampRect(box: Rect, viewport: Rect): Rect {
  const width = box.right - box.left;
  const height = box.bottom - box.top;
  const left = Math.min(
    Math.max(box.left, viewport.left),
    Math.max(viewport.left, viewport.right - width),
  );
  const top = Math.min(
    Math.max(box.top, viewport.top),
    Math.max(viewport.top, viewport.bottom - height),
  );
  return { left, top, right: left + width, bottom: top + height };
}

/** Draws laid-out pins then their labels (labels last so no ray crosses a name). */
export function renderPoiPinOverlay(
  ctx: CanvasRenderingContext2D,
  items: PoiPinOverlayItem[],
  font: string,
): void {
  for (const item of items)
    drawPoiPin(ctx, item.screenX, item.screenY, PHOTO_PIN_RADIUS_PX, item.color);
  ctx.font = font;
  ctx.textBaseline = 'top';
  // Dark halo under each name: a pin usually sits on a bright galaxy, where a bare
  // coloured label is hard to read.
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = HALO_COLOR;
  for (const item of items) {
    ctx.strokeText(item.label, item.labelBox.left, item.labelBox.top);
    ctx.fillStyle = item.color;
    ctx.fillText(item.label, item.labelBox.left, item.labelBox.top);
  }
  ctx.textBaseline = 'alphabetic';
}
