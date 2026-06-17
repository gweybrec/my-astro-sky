import { jsPDF } from 'jspdf';
import type { SkyMap } from './sky-map';
import { computeFovFrameCorners, type FovFrameSpec } from './sky-map';
import type { PhotoOverlay, PlacedPhoto } from './photo-overlay';
import type { Photo, DSO, ViewState } from './types';
import { project, toCanvas } from './projection';
import { angularSizeToCanvasPxForDSO } from './dso-highlight';
import { getConstellationInfos } from './star-catalog';
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

/** Full constellation name from its 3-letter IAU abbreviation (falls back to the abbr). */
function constellationFullName(abbr: string | null): string {
  if (!abbr) return '';
  const info = getConstellationInfos().find(c => c.id === abbr);
  const name = info?.displayName || abbr.toUpperCase();
  // The catalog uses wide Unicode spaces (e.g. U+2005 in "Hunting Dogs") which
  // render with broken spacing in the PDF — normalise them to plain spaces.
  return name.replace(/\s+/g, ' ').trim();
}

/** Draw a filled or outlined 5-pointed star centred at (cx, cy) with outer radius r. */
function drawStarGlyph(doc: jsPDF, cx: number, cy: number, r: number, filled: boolean): void {
  const pts: [number, number][] = [];
  for (let i = 0; i < 5; i++) {
    const oa = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    pts.push([cx + r * Math.cos(oa), cy + r * Math.sin(oa)]);
    const ia = oa + Math.PI / 5;
    pts.push([cx + r * 0.42 * Math.cos(ia), cy + r * 0.42 * Math.sin(ia)]);
  }
  const rel: [number, number][] = [];
  for (let i = 1; i < pts.length; i++) rel.push([pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]]);
  (doc as any).lines(rel, pts[0][0], pts[0][1], [1, 1], filled ? 'F' : 'S', true);
}

/** Draw a filled or outlined diamond centred at (cx, cy) with vertical half-height r. */
function drawDiamondGlyph(doc: jsPDF, cx: number, cy: number, r: number, filled: boolean): void {
  const w = r * 0.72;
  const pts: [number, number][] = [[cx, cy - r], [cx + w, cy], [cx, cy + r], [cx - w, cy]];
  const rel: [number, number][] = [];
  for (let i = 1; i < pts.length; i++) rel.push([pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]]);
  (doc as any).lines(rel, pts[0][0], pts[0][1], [1, 1], filled ? 'F' : 'S', true);
}

/** Draw a rounded "chip" (filled pill + label) and return its width so chips can be laid out in a row. */
function drawChip(
  doc: jsPDF,
  x: number,
  y: number,
  h: number,
  text: string,
  fill: [number, number, number],
  textColor: [number, number, number],
  border: [number, number, number],
): number {
  doc.setFont(undefined as any, 'normal');
  doc.setFontSize(8.5);
  const padX = 6;
  const w = doc.getTextWidth(text) + padX * 2;
  doc.setFillColor(fill[0], fill[1], fill[2]);
  doc.setDrawColor(border[0], border[1], border[2]);
  doc.setLineWidth(0.5);
  doc.roundedRect(x, y, w, h, 3, 3, 'FD');
  doc.setTextColor(textColor[0], textColor[1], textColor[2]);
  doc.text(text, x + padX, y + h / 2, { baseline: 'middle' });
  return w;
}

/** Draw a single micro uppercase label, returning the x cursor advanced past the column. */
function drawMetaColumn(doc: jsPDF, label: string, valueW: number, x: number, top: number): number {
  const up = label.toUpperCase();
  doc.setFont(undefined as any, 'normal');
  doc.setFontSize(7);
  doc.setTextColor(140, 140, 140);
  doc.text(up, x, top);
  const lw = doc.getTextWidth(up);
  return x + Math.max(lw, valueW) + 24;
}

/** Draw a row of label/value pairs (micro uppercase label above a bold value), returning the end x cursor. */
function drawMetaRow(doc: jsPDF, items: { label: string; value: string }[], x: number, top: number): number {
  let cx = x;
  for (const it of items) {
    doc.setFont(undefined as any, 'bold');
    doc.setFontSize(11);
    const vw = doc.getTextWidth(it.value);
    doc.setTextColor(60, 60, 60);
    doc.text(it.value, cx, top + 13);
    cx = drawMetaColumn(doc, it.label, vw, cx, top);
  }
  return cx;
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
  // Hide interactive frame instances during export so they don't clutter the
  // per-target pages (those draw their own centred frame via setFovFrames).
  const savedInstances = skyMap.getFovInstances();
  skyMap.setFovInstances([]);

  const fmtTime = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Per-target page split into three vertical bands: a compact DSO-info header,
  // a tall altitude-trajectory chart, and the framed sky view (bottom third).
  // The info content is short, so the chart absorbs the slack above it instead
  // of leaving a white gap.
  const contentW = pageW - margin * 2;
  const availH = pageH - margin * 2;
  const infoBandH = 112;          // compact header height (px)
  const frameH = availH / 3;      // bottom third for the framed sky view
  const imgTop = pageH - margin - frameH;
  const chartTop = margin + infoBandH;
  const chartGap = 16;
  const chartH = imgTop - chartTop - chartGap;  // chart fills the middle band

  // Chip / meta palette (PDF is on a white background, unlike the dark app theme).
  const typeFill: [number, number, number] = [238, 240, 242];
  const typeText: [number, number, number] = [90, 96, 104];
  const typeBorder: [number, number, number] = [210, 214, 220];
  const constFill: [number, number, number] = [232, 238, 250];
  const constText: [number, number, number] = [60, 96, 170];
  const constBorder: [number, number, number] = [200, 214, 240];

  try {
    skyMap.setFovFrames(opts.fovSpecs);

    for (let i = 0; i < opts.targets.length; i++) {
      const tgt = opts.targets[i];
      const dso = tgt.dso;
      if (i > 0) doc.addPage();

      // ── DSO info band (top third) ────────────────────────────────────────────
      // Title line: bold display name, dimmer catalog id, rating stars.
      const displayName = dso.displayName;
      const primaryId = dso.catalogs[0] || dso.id;
      const titleBaseline = margin + 16;
      (doc as any).setFont(undefined, 'bold');
      doc.setFontSize(17);
      doc.setTextColor(34, 34, 34);
      const titleText = displayName || primaryId;
      doc.text(titleText, margin, titleBaseline);
      let titleCursor = margin + doc.getTextWidth(titleText);
      if (displayName && primaryId) {
        (doc as any).setFont(undefined, 'normal');
        doc.setFontSize(12);
        doc.setTextColor(150, 150, 150);
        doc.text('  ' + primaryId, titleCursor, titleBaseline);
        titleCursor += doc.getTextWidth('  ' + primaryId);
      }
      // Rating stars next to the name.
      if (dso.rating !== null) {
        const starR = 5.5;
        const starGap = 3;
        const starCy = titleBaseline - 5;
        let sx = titleCursor + 16 + starR;
        for (let s = 0; s < 5; s++) {
          doc.setDrawColor(212, 160, 23);
          doc.setFillColor(212, 160, 23);
          doc.setLineWidth(0.6);
          drawStarGlyph(doc, sx, starCy, starR, s < dso.rating);
          sx += starR * 2 + starGap;
        }
      }

      // Chip row: DSO type + full constellation name.
      const chipY = titleBaseline + 10;
      const chipH = 16;
      let chipX = margin;
      const typeLabel = t(`dso.types.${dso.type}`) || dso.type;
      chipX += drawChip(doc, chipX, chipY, chipH, typeLabel, typeFill, typeText, typeBorder) + 6;
      const constName = constellationFullName(dso.constellation);
      if (constName) {
        chipX += drawChip(doc, chipX, chipY, chipH, constName, constFill, constText, constBorder) + 6;
      }

      // Metadata row: label/value pairs.
      const metaTop = chipY + chipH + 22;
      const metaItems: { label: string; value: string }[] = [];
      if (dso.mag !== null) metaItems.push({ label: 'Mag', value: dso.mag.toFixed(1) });
      if (dso.majAxis) metaItems.push({ label: t('targets.results.size'), value: fmtArcmin(dso.majAxis) });
      metaItems.push({ label: t('targets.results.bestTime'), value: fmtTime(tgt.bestTimeUtc) });
      metaItems.push({ label: t('targets.results.maxAlt'), value: `${Math.round(tgt.maxAltDeg)}°` });
      let metaX = drawMetaRow(doc, metaItems, margin, metaTop);
      // Difficulty rendered as diamonds (filled = required), drawn as vectors
      // because jsPDF's standard fonts don't include the ◆/◇ glyphs.
      if (dso.difficulty !== null) {
        const diaR = 4.5;
        const diaGap = 2.5;
        const diaCy = metaTop + 13 - diaR + 0.5;
        const diaW = 5 * (diaR * 0.72 * 2 + diaGap);
        let dx = metaX + diaR * 0.72;
        for (let s = 0; s < 5; s++) {
          doc.setDrawColor(110, 130, 165);
          doc.setFillColor(110, 130, 165);
          doc.setLineWidth(0.6);
          drawDiamondGlyph(doc, dx, diaCy, diaR, s < dso.difficulty);
          dx += diaR * 0.72 * 2 + diaGap;
        }
        drawMetaColumn(doc, t('targets.sort.difficulty'), diaW, metaX, metaTop);
      }

      // ── Altitude trajectory chart (tall — fills the band above the sky view) ──
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
      doc.addImage(chartOff.toDataURL('image/png'), 'PNG', margin, chartTop, contentW, chartH);

      // ── Framed sky view (bottom third) ───────────────────────────────────────
      const imgW = contentW;
      const imgH = frameH;
      const off = document.createElement('canvas');
      off.width = Math.round(imgW * dpr);
      off.height = Math.round(imgH * dpr);
      const p = project(dso.ra, dso.dec);
      const scale = spec
        ? computeFramedViewScale(spec.wDeg, spec.hDeg, dso.dec, imgW, imgH, 0.55)
        : baseView.scale * 4;
      const view: ViewState = { centerX: p.x, centerY: p.y, scale, rotationDeg: baseView.rotationDeg, width: imgW, height: imgH };
      skyMap.renderToCanvas(off, view, dpr);
      doc.addImage(off.toDataURL('image/jpeg', 0.95), 'JPEG', margin, imgTop, imgW, imgH);
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
    skyMap.setFovInstances(savedInstances);
  }

  return doc.output('blob');
}
