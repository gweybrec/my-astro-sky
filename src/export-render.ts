import { jsPDF } from 'jspdf';
import type { SkyMap } from './sky-map';
import type { PhotoOverlay, PlacedPhoto } from './photo-overlay';
import type { Photo } from './types';

// ─── Affine helpers (pure, unit-tested) ─────────────────────────────────────

export interface AffineCoeffs {
  a: number; b: number; c: number; d: number; e: number; f: number;
}

/**
 * Scale a CSS-pixel affine matrix to backing-store pixels.
 *
 * Photo overlay matrices map photo-pixel space → CSS canvas pixels, but the
 * sky canvas backing store is `devicePixelRatio`-scaled. Drawing onto an
 * offscreen canvas sized to the backing store therefore needs every output
 * coordinate multiplied by `dpr` — which for an affine matrix means scaling
 * all six coefficients.
 */
export function scaleMatrixForDpr(m: AffineCoeffs, dpr: number): AffineCoeffs {
  return { a: m.a * dpr, b: m.b * dpr, c: m.c * dpr, d: m.d * dpr, e: m.e * dpr, f: m.f * dpr };
}

// ─── Gallery contact-sheet layout (pure, unit-tested) ───────────────────────

export interface GalleryLayout {
  columns: number;
  rowsPerPage: number;
  perPage: number;
  pages: number;
  cellW: number;   // full cell width (image area width)
  cellH: number;   // full cell height (image area + caption)
  imgH: number;    // image area height (cellH minus caption)
}

/** Compute the contact-sheet grid for `count` photos on the given page. */
export function computeGalleryLayout(
  count: number,
  pageW: number,
  pageH: number,
  margin: number,
  gap: number,
  columns: number,
  captionH: number,
): GalleryLayout {
  const usableW = pageW - margin * 2;
  const cellW = (usableW - gap * (columns - 1)) / columns;
  const imgH = cellW * (2 / 3); // 3:2 landscape thumbnail box
  const cellH = imgH + captionH;
  const usableH = pageH - margin * 2;
  const rowsPerPage = Math.max(1, Math.floor((usableH + gap) / (cellH + gap)));
  const perPage = rowsPerPage * columns;
  const pages = Math.max(1, Math.ceil(Math.max(count, 1) / perPage));
  return { columns, rowsPerPage, perPage, pages, cellW, cellH, imgH };
}

// ─── DOM/canvas helpers ─────────────────────────────────────────────────────

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = src;
  await img.decode();
  return img;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob returned null'))),
      type,
      quality,
    );
  });
}

// ─── Map composite render ────────────────────────────────────────────────────

/**
 * Which part of the sky map to export:
 * - `'view'`  → the current on-screen viewport (typically zoomed in).
 * - `'full'`  → the entire sky map (whole border circle), regardless of zoom.
 */
export type MapExportScope = 'view' | 'full';

/** Draw one placed photo onto `ctx` using `m` (photo→canvas, CSS px) scaled by `dpr`. */
async function drawPlacedPhoto(
  ctx: CanvasRenderingContext2D,
  placed: PlacedPhoto,
  m: AffineCoeffs,
  dpr: number,
): Promise<void> {
  // Load full-resolution image for quality (on-screen img may be a thumbnail via LOD swap).
  let img: HTMLImageElement;
  try {
    img = await loadImage(`/uploads/${placed.photo.filename}`);
  } catch {
    img = placed.imgEl; // fall back to whatever is on screen
  }

  const s = scaleMatrixForDpr(m, dpr);
  ctx.save();
  ctx.globalAlpha = placed.opacity;
  ctx.setTransform(s.a, s.b, s.c, s.d, s.e, s.f);
  ctx.drawImage(img, 0, 0, placed.photo.width, placed.photo.height);
  ctx.restore();
}

/**
 * Composite the sky map and the photos onto one offscreen canvas.
 *
 * - `'view'`: copies the live canvas (already rendered) and reads each photo's
 *   current CSS transform — an exact snapshot of what is on screen.
 * - `'full'`: re-renders the sky at a whole-map view off-screen and recomputes
 *   every photo's placement at that view.
 */
export async function renderMapToCanvas(
  skyMap: SkyMap,
  overlay: PhotoOverlay,
  scope: MapExportScope = 'view',
): Promise<HTMLCanvasElement> {
  const skyCanvas = skyMap.getCanvas();
  const dpr = window.devicePixelRatio || 1;

  const out = document.createElement('canvas');
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D context for export canvas');

  if (scope === 'full') {
    const cssW = skyCanvas.width / dpr;
    const cssH = skyCanvas.height / dpr;
    const view = skyMap.getFullMapView(cssW, cssH);
    out.width = Math.round(cssW * dpr);
    out.height = Math.round(cssH * dpr);

    // 1. Re-render the whole sky map off-screen at the full-map view.
    skyMap.renderToCanvas(out, view, dpr);

    // 2. Recompute each placed photo's transform at that view and draw it.
    for (const placed of overlay.getPlacedPhotos()) {
      if (!placed.visible) continue;
      const m = overlay.computeMatrixForView(placed, view);
      if (!m) continue;
      await drawPlacedPhoto(ctx, placed, m, dpr);
    }
  } else {
    out.width = skyCanvas.width;
    out.height = skyCanvas.height;

    // 1. Lay down the already-rendered live sky.
    ctx.drawImage(skyCanvas, 0, 0);

    // 2. Draw each visible photo with its current on-screen transform, in draw order.
    for (const placed of overlay.getPlacedPhotos()) {
      if (!placed.visible || placed.imgEl.style.display === 'none') continue;
      const transform = getComputedStyle(placed.imgEl).transform;
      if (!transform || transform === 'none') continue;
      const dm = new DOMMatrix(transform);
      await drawPlacedPhoto(ctx, placed, { a: dm.a, b: dm.b, c: dm.c, d: dm.d, e: dm.e, f: dm.f }, dpr);
    }
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return out;
}

/** Render the chosen part of the map (sky + placed photos) as a PNG blob. */
export async function renderMapToBlob(skyMap: SkyMap, overlay: PhotoOverlay, scope: MapExportScope = 'view'): Promise<Blob> {
  const out = await renderMapToCanvas(skyMap, overlay, scope);
  return canvasToBlob(out, 'image/png');
}

/** Render the chosen part of the map as a single-page PDF blob sized to the image. */
export async function renderMapToPdfBlob(skyMap: SkyMap, overlay: PhotoOverlay, scope: MapExportScope = 'view'): Promise<Blob> {
  const out = await renderMapToCanvas(skyMap, overlay, scope);
  const w = out.width;
  const h = out.height;
  const doc = new jsPDF({ orientation: w >= h ? 'landscape' : 'portrait', unit: 'px', format: [w, h] });
  doc.addImage(out.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, w, h);
  return doc.output('blob');
}

// ─── Gallery contact-sheet PDF ────────────────────────────────────────────────

/** Render the given (already-filtered) gallery photos as a multi-page PDF contact sheet. */
export async function renderGalleryPdf(photos: Photo[]): Promise<Blob> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'px', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 28;
  const gap = 14;
  const columns = 3;
  const captionH = 18;

  const layout = computeGalleryLayout(photos.length, pageW, pageH, margin, gap, columns, captionH);

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    const indexOnPage = i % layout.perPage;
    if (i > 0 && indexOnPage === 0) doc.addPage();

    const col = indexOnPage % columns;
    const row = Math.floor(indexOnPage / columns);
    const x = margin + col * (layout.cellW + gap);
    const y = margin + row * (layout.cellH + gap);

    // Thumbnail, contained within the image box preserving aspect ratio.
    const src = `/uploads/${photo.thumbFilename ?? photo.filename}`;
    try {
      const img = await loadImage(src);
      const scale = Math.min(layout.cellW / img.naturalWidth, layout.imgH / img.naturalHeight);
      const drawW = img.naturalWidth * scale;
      const drawH = img.naturalHeight * scale;
      const dx = x + (layout.cellW - drawW) / 2;
      const dy = y + (layout.imgH - drawH) / 2;
      doc.addImage(img, 'JPEG', dx, dy, drawW, drawH);
    } catch {
      // Skip image on load failure; caption still printed below.
    }

    // Caption: photo name (truncated to fit the cell).
    doc.setFontSize(9);
    const name = photo.originalName ?? '';
    const lines = doc.splitTextToSize(name, layout.cellW);
    doc.text(lines[0] ?? '', x + layout.cellW / 2, y + layout.imgH + 12, { align: 'center' });
  }

  return doc.output('blob');
}
