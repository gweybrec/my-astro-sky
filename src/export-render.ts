import { jsPDF } from 'jspdf';
import type { SkyMap } from './sky-map';
import { computeFovFrameCorners, type FovFrameSpec } from './sky-map';
import type { PhotoOverlay, PlacedPhoto } from './photo-overlay';
import type { Photo, DSO, ViewState } from './types';
import { project, toCanvas } from './projection';
import { angularSizeToCanvasPxForDSO } from './dso-highlight';
import { t } from './i18n';
import type { AltSample } from './sky-geometry';

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

// ─── Night-plan PDF ───────────────────────────────────────────────────────────

export interface PlanPdfTarget {
  dso: DSO;
  bestTimeUtc: Date;
  maxAltDeg: number;
  curve: AltSample[];
  nightWin: { start: Date; end: Date };
}

export interface PlanPdfOptions {
  planName: string;
  targets: PlanPdfTarget[];
  fovSpecs: FovFrameSpec[];
}

/**
 * Scale (canvas px per projection unit) that frames a `wDeg × hDeg` FOV so the
 * rectangle occupies `frac` of the `imgW × imgH` image (whichever axis binds).
 * Pure — reuses the same angular-size mapping the live FOV frame uses.
 */
export function computeFramedViewScale(
  wDeg: number,
  hDeg: number,
  decDeg: number,
  imgW: number,
  imgH: number,
  frac = 0.6,
): number {
  const halfWAt1 = angularSizeToCanvasPxForDSO(wDeg * 30, decDeg, 1);
  const halfHAt1 = angularSizeToCanvasPxForDSO(hDeg * 30, decDeg, 1);
  const sW = halfWAt1 > 0 ? (frac * imgW) / (2 * halfWAt1) : Infinity;
  const sH = halfHAt1 > 0 ? (frac * imgH) / (2 * halfHAt1) : Infinity;
  const s = Math.min(sW, sH);
  return isFinite(s) && s > 0 ? s : 1;
}

/** Draw a rotated FOV rectangle + centre dot at each target on the overview canvas. */
function drawOverviewFrames(
  canvas: HTMLCanvasElement,
  view: ViewState,
  dpr: number,
  targets: PlanPdfTarget[],
  spec: FovFrameSpec | null,
  rotationDeg: number,
  styleEl: HTMLElement,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const stroke = getComputedStyle(styleEl).getPropertyValue('--fov-frame-stroke').trim() || 'rgba(220,60,60,0.85)';
  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.fillStyle = stroke;
  ctx.lineWidth = 1.5 * dpr;
  for (const tgt of targets) {
    const p = project(tgt.dso.ra, tgt.dso.dec);
    const c = toCanvas(p.x, p.y, view);
    const cx = c.x * dpr;
    const cy = c.y * dpr;
    let halfW = 4 * dpr;
    let halfH = 4 * dpr;
    if (spec) {
      halfW = Math.max(angularSizeToCanvasPxForDSO(spec.wDeg * 30, tgt.dso.dec, view.scale) * dpr, 3 * dpr);
      halfH = Math.max(angularSizeToCanvasPxForDSO(spec.hDeg * 30, tgt.dso.dec, view.scale) * dpr, 3 * dpr);
    }
    const corners = computeFovFrameCorners(halfW, halfH, cx, cy, rotationDeg);
    ctx.setLineDash([6 * dpr, 4 * dpr]);
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(cx, cy, 2 * dpr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Inline helper — mirrors formatArcmin in targets-view.ts. */
function fmtArcmin(v: number | null): string {
  if (v === null) return '';
  return v >= 60 ? `${(v / 60).toFixed(1)}°` : `${v.toFixed(1)}'`;
}

/**
 * Draw an altitude trajectory chart (fixed 0–90° Y-axis) onto a 2D canvas
 * context at position (offsetX, offsetY), covering (w × h) logical pixels.
 * Uses `dpr` to scale strokes and fonts onto the backing-store canvas.
 */
function drawAltChartToCanvas(
  ctx: CanvasRenderingContext2D,
  curve: AltSample[],
  win: { start: Date; end: Date },
  transitTime: Date,
  offsetX: number,
  offsetY: number,
  w: number,
  h: number,
  dpr: number,
): void {
  if (curve.length === 0) return;
  ctx.save();
  ctx.translate(offsetX, offsetY);

  const padY = (7 / 53) * h;
  const usableH = h - 2 * padY;
  const span = (win.end.getTime() - win.start.getTime()) || 1;

  // Left gutter reserved for the axis-label graduations (outside the plot).
  const gutter = 18 * dpr;
  const plotW = w - gutter;

  const xAt = (d: Date) => gutter + ((d.getTime() - win.start.getTime()) / span) * plotW;
  const yAt = (alt: number) => padY + (1 - Math.max(0, Math.min(90, alt)) / 90) * usableH;

  const alts = curve.map(s => s.altDeg);
  const objLo = Math.max(0, Math.min(...alts));
  const objHi = Math.max(...alts);

  const AXIS_TICKS = [0, 20, 40, 60, 80];

  // Left-axis graduations: faint gridlines at 0/20/40/60/80° (drawn behind the curve).
  ctx.strokeStyle = 'rgba(150,150,150,0.35)';
  ctx.lineWidth = Math.max(1, 0.5 * dpr);
  for (const deg of AXIS_TICKS) {
    const gy = yAt(deg);
    ctx.beginPath(); ctx.moveTo(gutter, gy); ctx.lineTo(w, gy); ctx.stroke();
  }

  // Left vertical axis — always present, for a consistent frame.
  ctx.strokeStyle = 'rgba(150,150,150,0.6)';
  ctx.lineWidth = dpr;
  ctx.beginPath(); ctx.moveTo(gutter, padY); ctx.lineTo(gutter, h - padY); ctx.stroke();

  // Reference lines at object's actual min/max altitude.
  ctx.strokeStyle = 'rgba(100,100,100,0.5)';
  ctx.lineWidth = dpr;
  ctx.setLineDash([3 * dpr, 3 * dpr]);
  for (const refAlt of [objLo, objHi]) {
    const ry = yAt(refAlt);
    ctx.beginPath(); ctx.moveTo(gutter, ry); ctx.lineTo(w, ry); ctx.stroke();
  }
  ctx.setLineDash([]);

  // Area fill under trajectory.
  const pts = curve.map(s => ({ px: xAt(s.time), py: yAt(s.altDeg) }));
  const yMin = yAt(objLo);
  ctx.fillStyle = 'rgba(59,130,246,0.15)';
  ctx.beginPath();
  ctx.moveTo(pts[0].px, yMin);
  for (const p of pts) ctx.lineTo(p.px, p.py);
  ctx.lineTo(w, yMin);
  ctx.closePath();
  ctx.fill();

  // Trajectory line.
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 1.5 * dpr;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0].px, pts[0].py);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].px, pts[i].py);
  ctx.stroke();

  // Transit vertical dashed line + time label.
  const tFrac = (transitTime.getTime() - win.start.getTime()) / span;
  if (tFrac >= 0 && tFrac <= 1) {
    const tx = xAt(transitTime);
    ctx.strokeStyle = 'rgba(120,120,120,0.7)';
    ctx.lineWidth = dpr;
    ctx.setLineDash([2 * dpr, 2 * dpr]);
    ctx.beginPath(); ctx.moveTo(tx, padY); ctx.lineTo(tx, h - padY); ctx.stroke();
    ctx.setLineDash([]);

    const fmtTime = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const fontSize = 8 * dpr;
    ctx.font = `${fontSize}px sans-serif`;
    ctx.fillStyle = 'rgba(80,80,80,0.9)';
    ctx.textAlign = 'center';
    // The PDF chart is too short for a below-line label, so the hour rides with
    // the "Transit" label at the top.
    const label = `${t('targets.plan.transit')} ${fmtTime(transitTime)}`;
    const halfW = ctx.measureText(label).width / 2;
    const lx = Math.max(gutter + halfW, Math.min(w - halfW, tx));
    ctx.fillText(label, lx, padY - 1 * dpr);
  }

  // Left-axis graduation labels, in the gutter to the left of the axis.
  const tickFont = 7 * dpr;
  ctx.font = `${tickFont}px sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(80,80,80,0.9)';
  for (const deg of AXIS_TICKS) {
    ctx.fillText(`${deg}°`, gutter - 2 * dpr, yAt(deg));
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.restore();
}

/**
 * Render a night plan as a multi-page PDF: one page per target with DSO info,
 * altitude chart, and framed sky view; plus a final constellation-lines-only
 * overview marking each target's FOV footprint (no text on this page).
 * The live map's FOV frames are saved and restored.
 */
export async function renderPlanPdf(skyMap: SkyMap, opts: PlanPdfOptions): Promise<Blob> {
  const dpr = Math.max(2, window.devicePixelRatio || 2);
  const doc = new jsPDF({ orientation: 'portrait', unit: 'px', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 28;
  const baseView = skyMap.getView();
  const spec = opts.fovSpecs[0] ?? null;
  const savedFrames = skyMap.getFovFrames();

  const targetName = (d: DSO) => d.displayName || d.catalogs[0] || d.id;
  const fmtTime = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Per-target page vertical layout constants.
  const infoH = 44;   // DSO info text block height (px)
  const chartH = 50;  // altitude trajectory chart height (px)
  const headerH = infoH + chartH + 8;  // total header above sky image

  const contentW = pageW - margin * 2;
  const availH = pageH - margin * 2 - headerH;
  const imgW = contentW;
  const imgH = Math.min(imgW, availH);  // square-ish, never taller than available

  try {
    skyMap.setFovFrames(opts.fovSpecs);

    for (let i = 0; i < opts.targets.length; i++) {
      const tgt = opts.targets[i];
      if (i > 0) doc.addPage();

      // ── DSO info block ──────────────────────────────────────────────────────
      let iy = margin + 14;
      doc.setFontSize(14);
      (doc as any).setFont(undefined, 'bold');
      doc.text(targetName(tgt.dso), margin, iy);
      iy += 16;
      (doc as any).setFont(undefined, 'normal');
      doc.setFontSize(9);
      const typePart = t(`dso.types.${tgt.dso.type}`) || tgt.dso.type;
      const constPart = tgt.dso.constellation?.toUpperCase() ?? '';
      const magPart = tgt.dso.mag !== null ? `Mag ${tgt.dso.mag.toFixed(1)}` : '';
      const sizePart = fmtArcmin(tgt.dso.majAxis);
      const transitPart = `${t('targets.plan.transit')} ${fmtTime(tgt.bestTimeUtc)}`;
      const altPart = `Max ${Math.round(tgt.maxAltDeg)}°`;
      const details = [typePart, constPart, magPart, sizePart, transitPart, altPart].filter(Boolean).join('  ·  ');
      doc.text(details, margin, iy);
      iy += 14;

      // ── Altitude trajectory chart ───────────────────────────────────────────
      const chartOff = document.createElement('canvas');
      chartOff.width = Math.round(contentW * dpr);
      chartOff.height = Math.round(chartH * dpr);
      const chartCtx = chartOff.getContext('2d')!;
      // Light background matching PDF white background.
      chartCtx.fillStyle = '#f8f8f8';
      chartCtx.fillRect(0, 0, chartOff.width, chartOff.height);
      if (tgt.curve.length > 0) {
        drawAltChartToCanvas(chartCtx, tgt.curve, tgt.nightWin, tgt.bestTimeUtc,
          0, 0, chartOff.width, chartOff.height, dpr);
      }
      doc.addImage(chartOff.toDataURL('image/png'), 'PNG', margin, iy, contentW, chartH);
      iy += chartH + 8;

      // ── Framed sky view ─────────────────────────────────────────────────────
      const off = document.createElement('canvas');
      off.width = Math.round(imgW * dpr);
      off.height = Math.round(imgH * dpr);
      const p = project(tgt.dso.ra, tgt.dso.dec);
      const scale = spec
        ? computeFramedViewScale(spec.wDeg, spec.hDeg, tgt.dso.dec, imgW, imgH, 0.6)
        : baseView.scale * 4;
      const view: ViewState = { centerX: p.x, centerY: p.y, scale, rotationDeg: baseView.rotationDeg, width: imgW, height: imgH };
      skyMap.renderToCanvas(off, view, dpr);
      doc.addImage(off.toDataURL('image/jpeg', 0.95), 'JPEG', margin, iy, imgW, imgH);
    }

    // Overview page: constellation lines + frame markers per target — no text.
    doc.addPage();
    const ovW = pageW - margin * 2;
    const ovH = pageH - margin * 2;
    // Clear FOV frames so the live frame label doesn't appear in the overview.
    skyMap.setFovFrames([]);
    const off = document.createElement('canvas');
    off.width = Math.round(ovW * dpr);
    off.height = Math.round(ovH * dpr);
    const fullView = skyMap.getFullMapView(ovW, ovH);
    skyMap.renderToCanvas(off, fullView, dpr, {
      showStars: false, showDSOs: false, showConstellationNames: false,
      showGrid: false, showStarLabels: false, showDSOLabels: false, showConstellationLines: true,
    });
    drawOverviewFrames(off, fullView, dpr, opts.targets, spec, skyMap.getFovRotationDeg(), skyMap.getCanvas());
    doc.addImage(off.toDataURL('image/jpeg', 0.9), 'JPEG', margin, margin, ovW, ovH);
  } finally {
    skyMap.setFovFrames(savedFrames);
  }

  return doc.output('blob');
}
