/**
 * Self-contained canvas draw helpers for the sky map, extracted from `sky-map.ts`
 * purely to keep that file focused. These are the layers that depend only on the
 * context, the view, the theme and catalog data (no sprite atlas, spatial index or
 * LOD budget) — background, the two grids, constellation lines/names, and the frame
 * edit glyphs. They are imperative canvas code (not unit-tested), but isolating them
 * shrinks the coordinator and makes the render pipeline easier to read.
 */
import type { Point, ViewState, ConstellationStyle } from './types';
import {
  project,
  toCanvas,
  getHemisphere,
  getCenterMode,
  zenithHorizonCrossing,
} from './projection';
import { getConstellationLines, getConstellationInfos } from './star-catalog';
import { raDecFromAltAz } from './sky-geometry';
import { horizonAltAt, type HorizonProfile, type HorizonSummit } from './horizon-io';
import type { SKY_THEME } from './sky-themes';
import {
  FONTS,
  GRID,
  TILE_BUTTON,
  HORIZON_LINE,
  MOUNTAIN_HORIZON,
  CARDINAL_POINTS,
  SUMMIT_DOT,
} from './canvas-theme';
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

  // In fisheye/zenith mode, off-projection points (far hemisphere, or below the
  // horizon in local-sky mode) project to (1e6, 1e6); the pen is lifted there so a
  // line doesn't streak across the sky. In zenith mode we additionally clip each
  // horizon-straddling edge at the rim (alt=0) so the visible part of a line joining
  // a star above the horizon to one below it is still drawn — up to the edge — rather
  // than dropped entirely. (`prev*` track the previous vertex to find that crossing.)
  const clipAtHorizon = getCenterMode() === 'zenith';

  for (const constellation of lines) {
    for (const segment of constellation.segments) {
      if (segment.length < 2) continue;

      ctx.beginPath();
      let penDown = false;
      let prevRa = 0;
      let prevDec = 0;
      let prevVisible = false;
      for (let i = 0; i < segment.length; i++) {
        const ra = segment[i][0];
        const dec = segment[i][1];
        const p = project(ra, dec);
        const visible = p.x < 1e5;

        if (visible) {
          const c = toCanvas(p.x, p.y, view);
          if (penDown) {
            ctx.lineTo(c.x, c.y);
          } else {
            // Entering the visible region from a below-horizon vertex: begin at the
            // rim so the line re-enters from the edge rather than jumping to the star.
            if (clipAtHorizon && i > 0 && !prevVisible) {
              const edge = zenithHorizonCrossing(prevRa, prevDec, ra, dec);
              if (edge) {
                const e = toCanvas(edge.x, edge.y, view);
                ctx.moveTo(e.x, e.y);
                ctx.lineTo(c.x, c.y);
                penDown = true;
              }
            }
            if (!penDown) {
              ctx.moveTo(c.x, c.y);
              penDown = true;
            }
          }
        } else {
          // Leaving the visible region: extend the line to the rim before lifting, so
          // the visible portion reaches the horizon edge instead of stopping short.
          if (clipAtHorizon && penDown && prevVisible) {
            const edge = zenithHorizonCrossing(prevRa, prevDec, ra, dec);
            if (edge) {
              const e = toCanvas(edge.x, edge.y, view);
              ctx.lineTo(e.x, e.y);
            }
          }
          penDown = false;
        }

        prevRa = ra;
        prevDec = dec;
        prevVisible = visible;
      }

      ctx.stroke();
    }
  }
}

// ── Horizon line + azimuth (alt-az) grid (date mode) ─────────────────────────
// The RA/Dec grid's declination circles are closed-form (centred on the celestial
// pole), but a curve of constant altitude or constant azimuth, for an arbitrary
// lat/LST, is generally NOT centred on the projection origin — so both are stepped
// and stitched the same way as `drawConstellationLines`: walk the varying
// coordinate in small increments, convert each point to RA/Dec via the inverse
// alt-az transform, project, and connect with lineTo (lifting the pen at
// off-projection points, e.g. the far hemisphere in fisheye mode).

const ALTAZ_STEP_DEG = 2;

/** Strokes a curve of constant altitude (azimuth 0→360) — the horizon is alt=0. */
function strokeAltCircle(
  ctx: CanvasRenderingContext2D,
  view: ViewState,
  altDeg: number,
  lstH: number,
  latDeg: number,
): void {
  ctx.beginPath();
  let penDown = false;
  for (let az = 0; az <= 360; az += ALTAZ_STEP_DEG) {
    const { raDeg, decDeg } = raDecFromAltAz(altDeg, az, lstH, latDeg);
    const p = project(raDeg, decDeg);
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

/** Strokes a curve of constant azimuth (altitude 0→90, horizon to zenith). */
function strokeAzMeridian(
  ctx: CanvasRenderingContext2D,
  view: ViewState,
  azDeg: number,
  lstH: number,
  latDeg: number,
): void {
  ctx.beginPath();
  let penDown = false;
  for (let alt = 0; alt <= 90; alt += ALTAZ_STEP_DEG) {
    const { raDeg, decDeg } = raDecFromAltAz(alt, azDeg, lstH, latDeg);
    const p = project(raDeg, decDeg);
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

// ── RA/Dec grid in zenith ("local sky") mode ──────────────────────────────────
// The roles are reversed from pole-centered mode: RA/Dec circles are no longer
// closed-form around the origin (only alt/az circles are, since the projection is
// now zenith-centered), so they're stepped the same way strokeAltCircle/
// strokeAzMeridian step alt/az above — but project() already converts RA/Dec to
// alt/az internally while zenith mode is active, so these can call project()
// directly with no alt/az round-trip in this file.

/** Strokes a declination circle (RA 0→360) in zenith mode. */
function strokeDecCircle(ctx: CanvasRenderingContext2D, view: ViewState, decDeg: number): void {
  ctx.beginPath();
  let penDown = false;
  for (let ra = 0; ra <= 360; ra += ALTAZ_STEP_DEG) {
    const p = project(ra, decDeg);
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

/** Strokes a right-ascension meridian (Dec -90→90) in zenith mode. */
function strokeRaMeridian(ctx: CanvasRenderingContext2D, view: ViewState, raDeg: number): void {
  ctx.beginPath();
  let penDown = false;
  for (let dec = -90; dec <= 90; dec += ALTAZ_STEP_DEG) {
    const p = project(raDeg, dec);
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

/**
 * RA/Dec grid for zenith-centered ("local sky") mode: dec circles every 10°
 * (skipping the poles) and RA meridians every 2h, all stepped through project()
 * since none of them are circles/lines around the zenith origin. Replaces
 * `drawGrid`/`drawFisheyeGrid` while local-sky mode is active.
 */
export function drawGridZenith(
  ctx: CanvasRenderingContext2D,
  view: ViewState,
  theme: SkyTheme,
): void {
  for (let dec = -80; dec <= 80; dec += 10) {
    ctx.strokeStyle = dec === 0 ? theme.gridEquatorColor : theme.gridColor;
    ctx.lineWidth = dec === 0 ? GRID.equatorLineWidth : GRID.lineWidth;
    strokeDecCircle(ctx, view, dec);
  }
  ctx.strokeStyle = theme.gridColor;
  ctx.lineWidth = GRID.lineWidth;
  for (let raH = 0; raH < 24; raH += 2) {
    strokeRaMeridian(ctx, view, raH * 15);
  }
}

/**
 * Draw the horizon (alt = 0) as a curve across the sky. `color` is normally the
 * live `--accent-color` CSS var (resolved by the caller) so it tracks the current
 * warm/cold UI theme instead of a fixed hardcoded hue.
 */
export function drawHorizonLine(
  ctx: CanvasRenderingContext2D,
  view: ViewState,
  lstH: number,
  latDeg: number,
  color: string,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = HORIZON_LINE.lineWidth;
  strokeAltCircle(ctx, view, 0, lstH, latDeg);
}

/**
 * Draw the alt-az grid: altitude rings every 20° (20-80, the horizon itself is
 * drawn separately by drawHorizonLine) and azimuth meridians every 30° from the
 * horizon to the zenith. Uses a distinct hue from the RA/Dec grid so both read
 * separately when shown together.
 */
export function drawAzimuthGrid(
  ctx: CanvasRenderingContext2D,
  view: ViewState,
  lstH: number,
  latDeg: number,
  theme: SkyTheme,
): void {
  ctx.strokeStyle = theme.azGridColor;
  ctx.lineWidth = GRID.lineWidth;
  for (let alt = 20; alt <= 80; alt += 20) {
    strokeAltCircle(ctx, view, alt, lstH, latDeg);
  }
  for (let az = 0; az < 360; az += 30) {
    strokeAzMeridian(ctx, view, az, lstH, latDeg);
  }
}

/**
 * Draw the observer's real terrain skyline from a horizon profile: a warm
 * silhouette line following the terrain altitude at each azimuth, over a
 * translucent fill of the blocked band down to the astronomical horizon (alt=0).
 *
 * Stepped and pen-lifted exactly like `strokeAltCircle`, but with the altitude
 * varying per azimuth from the profile — so it renders correctly in both the
 * zenith "local sky" view and the pole-centered stereographic date view.
 *
 * The filled ground band (only in zenith mode) is drawn as a strip of small
 * per-azimuth quads spanning from the silhouette down to the astronomical horizon
 * (alt = 0). Filling many locally-wound quads is immune to the fill-side inversion
 * that a single silhouette-to-rim polygon suffered: there, the two boundary loops
 * wound oppositely and the alt=0 round-trip dropped points near the rim, so the
 * fill flipped across the E/W diameter. In stereo mode the curves run
 * off-projection, so only the silhouette line is stroked.
 */
export function drawMountainHorizon(
  ctx: CanvasRenderingContext2D,
  view: ViewState,
  lstH: number,
  latDeg: number,
  profile: HorizonProfile,
): void {
  // Silhouette point in *projection units* (origin = zenith in zenith mode).
  const projPt = (altDeg: number, azDeg: number): Point | null => {
    const { raDeg, decDeg } = raDecFromAltAz(altDeg, azDeg, lstH, latDeg);
    const p = project(raDeg, decDeg);
    if (p.x >= 1e5) return null; // far hemisphere / off-projection
    return p;
  };

  if (getCenterMode() === 'zenith') {
    // In zenith mode the astronomical horizon is exactly the unit circle (r = 1)
    // around the origin, and the silhouette at a given azimuth lies on the same
    // radial ray. So the rim point is the silhouette point scaled out to r = 1 —
    // this never calls project(alt=0), whose RA/Dec round-trip is unstable at the
    // rim and dropped points (previously leaving the southern band unfilled).
    ctx.beginPath();
    for (let az = 0; az < 360; az += ALTAZ_STEP_DEG) {
      const az2 = az + ALTAZ_STEP_DEG;
      // Clamp the silhouette to the horizon: where terrain dips below alt=0 there is
      // no blocked band, so that wedge collapses to zero height (nothing filled).
      const a1 = Math.max(0, horizonAltAt(profile, az));
      const a2 = Math.max(0, horizonAltAt(profile, az2));
      if (a1 <= 0 && a2 <= 0) continue;
      const p1 = projPt(a1, az);
      const p2 = projPt(a2, az2);
      if (!p1 || !p2) continue;
      const r1 = Math.hypot(p1.x, p1.y) || 1e-6;
      const r2 = Math.hypot(p2.x, p2.y) || 1e-6;
      const s1 = toCanvas(p1.x, p1.y, view);
      const s2 = toCanvas(p2.x, p2.y, view);
      const rim1 = toCanvas(p1.x / r1, p1.y / r1, view); // same ray, scaled to r=1
      const rim2 = toCanvas(p2.x / r2, p2.y / r2, view);
      ctx.moveTo(s1.x, s1.y);
      ctx.lineTo(s2.x, s2.y);
      ctx.lineTo(rim2.x, rim2.y);
      ctx.lineTo(rim1.x, rim1.y);
      ctx.closePath();
    }
    ctx.fillStyle = MOUNTAIN_HORIZON.fill;
    ctx.fill();
  }

  ctx.strokeStyle = MOUNTAIN_HORIZON.stroke;
  ctx.lineWidth = MOUNTAIN_HORIZON.lineWidth;
  ctx.beginPath();
  let penDown = false;
  for (let az = 0; az <= 360; az += ALTAZ_STEP_DEG) {
    const { raDeg, decDeg } = raDecFromAltAz(horizonAltAt(profile, az), az, lstH, latDeg);
    const p = project(raDeg, decDeg);
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

/**
 * Draw small star-like dots on named summits that sit on the terrain skyline.
 * Each summit is placed at (altDeg, azDeg) — its altDeg is the silhouette altitude
 * at that azimuth, so the dot lands on the drawn ridge line. Hover hit-testing and
 * the name/altitude tooltip are handled in sky-map.ts / ui.ts.
 */
export function drawSummitDots(
  ctx: CanvasRenderingContext2D,
  view: ViewState,
  lstH: number,
  latDeg: number,
  summits: HorizonSummit[],
): void {
  ctx.lineWidth = SUMMIT_DOT.outlineWidth;
  for (const s of summits) {
    const { raDeg, decDeg } = raDecFromAltAz(s.altDeg, s.azDeg, lstH, latDeg);
    const p = project(raDeg, decDeg);
    if (p.x >= 1e5) continue; // below horizon / far hemisphere in this projection
    const c = toCanvas(p.x, p.y, view);
    ctx.beginPath();
    ctx.arc(c.x, c.y, SUMMIT_DOT.radius, 0, Math.PI * 2);
    ctx.fillStyle = SUMMIT_DOT.fill;
    ctx.fill();
    ctx.strokeStyle = SUMMIT_DOT.outline;
    ctx.stroke();
  }
}

/**
 * Draw the four cardinal-point labels (N/E/S/W) in red at the horizon, each at its
 * compass azimuth (N = 0°, E = 90°, S = 180°, W = 270°), lifted just off the rim.
 * Labels are localized (e.g. W → O in French). Drawn on top of the terrain horizon
 * so they stay legible over the shaded ground — used to check the mountain silhouette
 * against the real sky. Same project/toCanvas path as the alt-az grid.
 */
export function drawCardinalPoints(
  ctx: CanvasRenderingContext2D,
  view: ViewState,
  lstH: number,
  latDeg: number,
  labels: { n: string; e: string; s: string; w: string },
): void {
  const points: { az: number; label: string }[] = [
    { az: 0, label: labels.n },
    { az: 90, label: labels.e },
    { az: 180, label: labels.s },
    { az: 270, label: labels.w },
  ];
  ctx.save();
  ctx.font = CARDINAL_POINTS.font;
  ctx.fillStyle = CARDINAL_POINTS.color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const { az, label } of points) {
    const { raDeg, decDeg } = raDecFromAltAz(CARDINAL_POINTS.altDeg, az, lstH, latDeg);
    const p = project(raDeg, decDeg);
    if (p.x >= 1e5) continue; // below the horizon / far hemisphere in this projection
    const c = toCanvas(p.x, p.y, view);
    ctx.fillText(label, c.x, c.y);
  }
  ctx.restore();
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
