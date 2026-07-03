/**
 * Self-contained canvas draw helpers for the sky map, extracted from `sky-map.ts`
 * purely to keep that file focused. These are the layers that depend only on the
 * context, the view, the theme and catalog data (no sprite atlas, spatial index or
 * LOD budget) — background, the two grids, constellation lines/names, and the frame
 * edit glyphs. They are imperative canvas code (not unit-tested), but isolating them
 * shrinks the coordinator and makes the render pipeline easier to read.
 */
import type { Point, ViewState, ConstellationStyle } from './types';
import { project, toCanvas, getHemisphere } from './projection';
import { getConstellationLines, getConstellationInfos } from './star-catalog';
import type { SKY_THEME } from './sky-themes';
import { FONTS, GRID, TILE_BUTTON } from './canvas-theme';
import pinSvgRaw from './icons/pin.svg?raw';

type SkyTheme = typeof SKY_THEME;
const DEG2RAD = Math.PI / 180;

// ── Background ───────────────────────────────────────────────────────────────

export function drawBackground(
  ctx: CanvasRenderingContext2D,
  view: ViewState,
  theme: SkyTheme,
  backgroundOpacity: number,
): void {
  const cx = view.width / 2;
  const cy = view.height / 2;
  const maxR = Math.sqrt(view.width * view.width + view.height * view.height);

  // Solid base (always opaque — ensures a clean floor at opacity 0)
  ctx.fillStyle = theme.baseFill;
  ctx.fillRect(0, 0, view.width, view.height);

  const bgAlpha = backgroundOpacity * theme.bgOpacityScale;
  if (bgAlpha <= 0) return;

  ctx.save();
  ctx.globalAlpha = bgAlpha;

  // Theme gradient overlay (center → corner)
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
  for (const [offset, color] of theme.bgStops) gradient.addColorStop(offset, color);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, view.width, view.height);

  // Optional vignette: transparent from center to innerStop, darkening to the rim
  if (theme.vignette) {
    const v = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(theme.vignette.innerStop, 'rgba(0,0,0,0)');
    v.addColorStop(1, theme.vignette.color);
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, view.width, view.height);
  }
  ctx.restore();
}

// ── Coordinate grids ─────────────────────────────────────────────────────────

export function drawFisheyeGrid(
  ctx: CanvasRenderingContext2D,
  view: ViewState,
  theme: SkyTheme,
): void {
  const origin = toCanvas(0, 0, view);
  const hem = getHemisphere();

  // Orthographic dome: equatorial RA/Dec grid, pole at centre, equator (r = 1)
  // at the outer edge. Declination circles every 10° from the pole to the equator.
  const decStart = hem === 'south' ? -80 : 80;
  const decStep = hem === 'south' ? 10 : -10;
  for (let dec = decStart; hem === 'south' ? dec <= 0 : dec >= 0; dec += decStep) {
    const r = Math.cos(dec * DEG2RAD) * view.scale;
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = dec === 0 ? theme.gridEquatorColor : theme.gridColor;
    ctx.lineWidth = dec === 0 ? GRID.equatorLineWidth : GRID.lineWidth;
    ctx.stroke();
    // Dec label at the bottom of the circle (skip the pole and the equator edge)
    if (r > 2 && Math.abs(dec) < 89 && dec !== 0) {
      ctx.fillStyle = theme.gridLabelColor;
      ctx.font = FONTS.gridLabel;
      ctx.fillText(`${dec}°`, origin.x + 4, origin.y + r - 2);
    }
  }

  // RA lines every 2h (30°) from the pole out to the equator
  for (let raH = 0; raH < 24; raH += 2) {
    const raRad = raH * 15 * DEG2RAD;
    const edge = toCanvas(Math.sin(raRad), Math.cos(raRad), view); // equator (r = 1)
    ctx.beginPath();
    ctx.moveTo(origin.x, origin.y);
    ctx.lineTo(edge.x, edge.y);
    ctx.strokeStyle = theme.gridColor;
    ctx.lineWidth = GRID.lineWidth;
    ctx.stroke();
    // RA label near the equator
    const labelProj = toCanvas(0.85 * Math.sin(raRad), 0.85 * Math.cos(raRad), view);
    ctx.fillStyle = theme.gridLabelColor;
    ctx.font = FONTS.gridLabel;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${raH}h`, labelProj.x, labelProj.y);
  }

  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  view: ViewState,
  theme: SkyTheme,
  borderLatDeg: number,
): void {
  const origin = toCanvas(0, 0, view);
  const hem = getHemisphere();

  // Declination circles every 10°
  // North: from +80° outward to -borderLatDeg (the clip edge); South: from -80° to +borderLatDeg
  const decStart = hem === 'south' ? -80 : 80;
  const decEnd = hem === 'south' ? borderLatDeg : -borderLatDeg;
  const decStep = hem === 'south' ? 10 : -10;

  for (let dec = decStart; hem === 'south' ? dec <= decEnd : dec >= decEnd; dec += decStep) {
    const r = Math.tan(((90 + (hem === 'south' ? dec : -dec)) / 2) * DEG2RAD) * view.scale;
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = dec === 0 ? theme.gridEquatorColor : theme.gridColor;
    ctx.lineWidth = dec === 0 ? GRID.equatorLineWidth : GRID.lineWidth;
    ctx.stroke();

    // Dec label (avoid labelling the pole and the boundary)
    if (r > 2 && Math.abs(dec) < 89) {
      ctx.fillStyle = theme.gridLabelColor;
      ctx.font = FONTS.gridLabel;
      ctx.fillText(`${dec}°`, origin.x + 4, origin.y + r - 2);
    }
  }

  // RA lines every 2h (30°)
  // borderRProj = projection radius of the border dec circle
  const borderRProj = Math.tan(((90 + borderLatDeg) / 2) * DEG2RAD);
  for (let raH = 0; raH < 24; raH += 2) {
    const raRad = raH * 15 * DEG2RAD;
    const borderCanvas = toCanvas(
      borderRProj * Math.sin(raRad),
      borderRProj * Math.cos(raRad),
      view,
    );

    ctx.beginPath();
    ctx.moveTo(origin.x, origin.y);
    ctx.lineTo(borderCanvas.x, borderCanvas.y);
    ctx.strokeStyle = theme.gridColor;
    ctx.lineWidth = GRID.lineWidth;
    ctx.stroke();

    // RA label near the equator (r=1 in projection units; slightly inner)
    const labelProj = toCanvas(0.85 * Math.sin(raRad), 0.85 * Math.cos(raRad), view);
    ctx.fillStyle = theme.gridLabelColor;
    ctx.font = FONTS.gridLabel;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${raH}h`, labelProj.x, labelProj.y);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }
}

// ── Constellations ───────────────────────────────────────────────────────────

export function drawConstellationLines(
  ctx: CanvasRenderingContext2D,
  view: ViewState,
  style: ConstellationStyle,
  color: string,
): void {
  const lines = getConstellationLines(style);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;

  for (const constellation of lines) {
    for (const segment of constellation.segments) {
      if (segment.length < 2) continue;

      ctx.beginPath();
      // In fisheye mode, points below the horizon project to (1e6, 1e6).
      // Lift the pen at those points so a line doesn't streak across the sky.
      let penDown = false;
      for (let i = 0; i < segment.length; i++) {
        const p = project(segment[i][0], segment[i][1]);
        if (p.x >= 1e5) {
          penDown = false;
          continue;
        }
        const c = toCanvas(p.x, p.y, view);
        if (penDown) {
          ctx.lineTo(c.x, c.y);
        } else {
          ctx.moveTo(c.x, c.y);
          penDown = true;
        }
      }

      ctx.stroke();
    }
  }
}

export function drawConstellationNames(
  ctx: CanvasRenderingContext2D,
  view: ViewState,
  theme: SkyTheme,
): void {
  const infos = getConstellationInfos();

  ctx.font = FONTS.constellationName;
  ctx.fillStyle = theme.constellationNameColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const info of infos) {
    const p = project(info.ra, info.dec);
    const c = toCanvas(p.x, p.y, view);
    if (c.x < -100 || c.x > view.width + 100 || c.y < -100 || c.y > view.height + 100) continue;
    ctx.fillText(info.displayName.toUpperCase(), c.x, c.y);
  }

  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}

// ── Frame edit glyphs (pin / trash / add) ────────────────────────────────────

/** Pushpin glyph path (24×24 box) extracted from the shared icon asset. */
const PIN_PATH_D = pinSvgRaw.match(/\bd="([^"]+)"/)?.[1] ?? '';
/** Lazily-built Path2D for the pushpin glyph. Lazy so module load does not require a
 * DOM (Path2D is absent in the unit-test environment). */
let pinPath2D: Path2D | null = null;
function getPinPath(): Path2D {
  return (pinPath2D ??= new Path2D(PIN_PATH_D));
}

/** Trash glyph (24×24 box), built from the shared trash icon's subpaths. Stroked. */
const TRASH_PATHS_D = ['M3 6L5 6L21 6', 'M19 6l-1 14H6L5 6', 'M10 11v6M14 11v6', 'M9 6V4h6v2'];
let trashPath2D: Path2D | null = null;
function getTrashPath(): Path2D {
  if (trashPath2D) return trashPath2D;
  const p = new Path2D();
  for (const d of TRASH_PATHS_D) p.addPath(new Path2D(d));
  return (trashPath2D = p);
}

/** Radius of a tile's delete/add button (re-exported for hit-testing in sky-map). */
export const TILE_TRASH_R = TILE_BUTTON.radius;

/** Draw the pushpin glyph centred at `at`, filled when pinned. Source path is a 24×24 box. */
export function drawPinGlyph(
  ctx: CanvasRenderingContext2D,
  at: Point,
  filled: boolean,
  color: string,
): void {
  const size = 16;
  ctx.save();
  ctx.translate(at.x - size / 2, at.y - size / 2);
  ctx.scale(size / 24, size / 24);
  const path = getPinPath();
  if (filled) {
    ctx.fillStyle = color;
    ctx.fill(path);
  } else {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.8 * (24 / size);
    ctx.stroke(path);
  }
  ctx.restore();
}

/** Draw a delete (trash) button centred at `at`, used per-tile on the selected mosaic. */
export function drawTileTrash(ctx: CanvasRenderingContext2D, at: Point, color: string): void {
  const size = 16;
  ctx.save();
  ctx.beginPath();
  ctx.arc(at.x, at.y, TILE_TRASH_R, 0, Math.PI * 2);
  ctx.fillStyle = TILE_BUTTON.bg;
  ctx.fill();
  ctx.translate(at.x - size / 2, at.y - size / 2);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 * (24 / size);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(getTrashPath());
  ctx.restore();
}

/** Draw an add (plus) button centred at `at`, used at the "+" spots around a mosaic. */
export function drawTileAdd(ctx: CanvasRenderingContext2D, at: Point, color: string): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(at.x, at.y, TILE_TRASH_R, 0, Math.PI * 2);
  ctx.fillStyle = TILE_BUTTON.bg;
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(at.x - 5, at.y);
  ctx.lineTo(at.x + 5, at.y);
  ctx.moveTo(at.x, at.y - 5);
  ctx.lineTo(at.x, at.y + 5);
  ctx.stroke();
  ctx.restore();
}
