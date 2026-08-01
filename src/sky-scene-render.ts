/**
 * Sky content draw passes — stars, DSOs, their labels, and the Moon/Sun/planets.
 * Extracted from `sky-map.ts`; every pass reads a {@link SkyScene} rather than the
 * canvas class, so what each one depends on is stated rather than implied.
 *
 * The maths these call is already unit-tested elsewhere (star-budget, star-render-math,
 * dso-render-math, dso-render-select); what remains here is canvas painting.
 */
import type { PlanetKey } from './astro-time';
import type { SkyScene } from './sky-scene';
import type { SkyThemeConfig } from './sky-themes';
import { t } from './i18n';
import {
  dateToJD,
  moonRaDecDeg,
  moonPhase,
  sunRaDecDeg,
  planetRaDecDeg,
  PLANET_KEYS,
} from './astro-time';
import { project, projectCached, toCanvas, isBelowHorizonCached } from './projection';
import { altAzFromRaDec } from './sky-geometry';
import { getStars } from './star-catalog';
import { starFaintLimitAt } from './star-budget';
import { starRadius, computeStarPaint } from './star-render-math';
import { paintStar, buildStarSprite } from './star-draw';
import { StarSpriteAtlas } from './star-sprite-atlas';
import { angularSizeToCanvasPx, dsoSizeCos2, dsoCanvasAngle } from './dso-render-math';
import { drawDsoMarker, drawDsoHighlightRing } from './dso-draw';
import { formatDsoLabel, dsoLabelVisible } from './dso-label';
import { drawMoonMarker } from './moon-draw';
import { drawBodyMarker, drawBodyLabel } from './body-draw';
import { FONTS, HIGHLIGHT_RING, DSO_LABEL_COLORS, DEFAULT_DSO_LABEL_COLOR } from './canvas-theme';

const DEG2RAD = Math.PI / 180;

const SUN_RADIUS_PX = 6;
const PLANET_RADIUS_PX = 3.5;

/**
 * Whether an object at `decDeg` is clearly outside the border and can be skipped
 * before any projection work. Stereo only — in fisheye the far hemisphere is clipped
 * by project() returning off-canvas, and in local-sky mode the horizon clip handles it.
 */
function outsideDecPrefilter(s: SkyScene, decDeg: number): boolean {
  if (s.localSkyMode || s.fisheyeMode) return false;
  if (s.hemisphere === 'north' && decDeg < -(s.borderLatDeg + 2)) return true;
  if (s.hemisphere === 'south' && decDeg > +(s.borderLatDeg + 2)) return true;
  return false;
}

export function renderStars(s: SkyScene): void {
  const { ctx, view, theme } = s;
  // Stars render at full opacity (not dimmed by skyOpacity like the rest of the
  // sky), so their opaque cores fully occlude constellation/grid lines behind
  // them instead of letting the line bleed through the middle of the star.
  const prevAlpha = ctx.globalAlpha;
  ctx.globalAlpha = 1;
  const stars = getStars();
  // Pan-invariant, area-weighted magnitude budget (see render-budget.ts). The precise
  // cutoff is per-position (starFaintLimitAt) — brighter near the crowded map centre,
  // fainter toward the edge — so on-screen star density stays uniform under the
  // stereographic projection's area distortion. `maxMag` here is the faintest limit
  // anywhere (the rim): it is the cheap pre-filter below and the single atlas/paint key
  // (so edge-fill stars share sprites and don't fade), while starFaintLimitAt applies
  // the exact per-star gate after projecting.
  const sb = s.starBudget;
  const maxMag = sb.edgeMag;

  const atlas = s.atlas.beginFrame(view.scale, maxMag, s.interacting);

  for (const star of stars) {
    // Always include the highlighted star.
    const isHighlighted = s.highlightedStar === star.hip;

    if (!isHighlighted) {
      if (star.mag > maxMag) continue;
      if (s.localSkyMode) {
        // Below-horizon stars are already hidden by the horizon-circle canvas
        // clip; this just skips the projection/bbox work for them earlier.
        if (s.horizon && isBelowHorizonCached(star, s.horizon.lstH, s.horizon.latDeg)) continue;
      } else if (outsideDecPrefilter(s, star.dec)) {
        continue;
      }
    }

    projectCached(star);

    // Area-weighted per-position gate: thin the crowded centre, keep the naked-eye
    // floor everywhere, allow fainter fill toward the edge. Runs after projecting so
    // it can read the local area factor from the cached _px/_py.
    if (!isHighlighted && star.mag > starFaintLimitAt(star._px!, star._py!, sb)) {
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
      s.horizon && !isHighlighted && isBelowHorizonCached(star, s.horizon.lstH, s.horizon.latDeg)
        ? s.belowHorizonAlpha
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
    // star above, gated to the exact frames (atlas.frozen) where the blur would show.
    if (atlas.frozen && star.mag < theme.glowThresholdMag) {
      const paint = computeStarPaint(star.mag, star.bv, view.scale, maxMag, theme, false);
      paintStar(ctx, c.x, c.y, paint);
      continue;
    }

    const key = StarSpriteAtlas.bucketKey(star.mag, star.bv);
    const sprite = s.atlas.spriteFor(key, (builtScale, builtMaxMag) =>
      buildStarSprite(computeStarPaint(star.mag, star.bv, builtScale, builtMaxMag, theme, false)),
    );
    if (atlas.spriteScale === 1) {
      ctx.drawImage(sprite.canvas, c.x - sprite.half, c.y - sprite.half);
    } else {
      const h = sprite.half * atlas.spriteScale;
      ctx.drawImage(
        sprite.canvas,
        c.x - h,
        c.y - h,
        sprite.canvas.width * atlas.spriteScale,
        sprite.canvas.height * atlas.spriteScale,
      );
    }
  }

  ctx.globalAlpha = prevAlpha;
}

export function renderStarLabels(s: SkyScene): void {
  const { ctx, view, theme } = s;
  const stars = getStars();

  ctx.font = FONTS.starLabel;
  ctx.fillStyle = theme.starLabelColor;
  ctx.textBaseline = 'middle';

  for (const star of stars) {
    if (star.mag > 3 || !star.name) continue;

    projectCached(star);
    const c = toCanvas(star._px!, star._py!, view);

    if (c.x < -50 || c.x > view.width + 50 || c.y < -50 || c.y > view.height + 50) {
      continue;
    }

    const r = starRadius(star.mag, view.scale, theme.brightZoomBoost);
    ctx.fillText(star.name, c.x + r + 3, c.y);
  }

  ctx.textBaseline = 'alphabetic';
}

export function renderDSOs(s: SkyScene): void {
  const { ctx, view, horizon } = s;

  for (const dso of s.selectedDSOs()) {
    projectCached(dso);
    const c = toCanvas(dso._px!, dso._py!, view);

    // Compute below-horizon state (and, as a side effect, _altDeg) before the size
    // calc: in zenith ("local sky") mode, angular size must scale with altitude
    // (the projection's pole), not dec — see dsoSizeCos2.
    const isHighlighted = dso.id === s.highlightedDSO;
    const isBelowHorizon = !!horizon && isBelowHorizonCached(dso, horizon.lstH, horizon.latDeg);

    const majorArcmin = dso.majAxis ?? 1;
    const minorArcmin = dso.minAxis ?? majorArcmin;
    const cos2 = dsoSizeCos2(dso, s.localSkyMode ? dso._altDeg : undefined);
    const rx = Math.max(2, angularSizeToCanvasPx(majorArcmin / 2, dso.dec, view.scale, cos2));
    const ry = Math.max(2, angularSizeToCanvasPx(minorArcmin / 2, dso.dec, view.scale, cos2));
    const angle = dsoCanvasAngle(dso, view.rotationDeg);

    // Opacity based on magnitude
    const mag = dso.mag ?? 10;
    const opacity = Math.min(1, Math.max(0.3, 1 - (mag - 4) * 0.07));
    // Below-horizon DSOs are dimmed (not hidden) in date mode, once a location is set.
    // The highlighted DSO stays at full brightness regardless (it's actively selected).
    const horizonMul = !isHighlighted && isBelowHorizon ? s.belowHorizonAlpha : 1;

    ctx.save();
    ctx.globalAlpha = opacity * s.skyOpacity * horizonMul;
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

export function renderDSOLabels(s: SkyScene): void {
  const { ctx, view } = s;
  ctx.textBaseline = 'middle';

  // Render labels for exactly the DSOs drawn this frame (shared selection).
  // In zenith mode, _altDeg is already fresh here — renderDSOs (or the selection's
  // own pre-filter) already ran isBelowHorizonCached on every one of these DSOs
  // earlier in this same render pass.
  for (const dso of s.selectedDSOs()) {
    const majorArcmin = dso.majAxis ?? 1;
    const rx = angularSizeToCanvasPx(
      majorArcmin / 2,
      dso.dec,
      view.scale,
      dsoSizeCos2(dso, s.localSkyMode ? dso._altDeg : undefined),
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

/**
 * Draws the Moon at its position for the current instant: real "now" in live mode
 * (so the Moon toggle works even outside date mode), or the simulated date/time in
 * date mode. Below-horizon dimming only applies in date mode with a location set —
 * `horizon` is always null in live mode, so the Moon simply never dims there.
 */
export function renderMoon(s: SkyScene): void {
  const { ctx, view, horizon, theme } = s;
  const date = s.skyTimeMode === 'live' ? new Date() : s.simDate;
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

  if (s.localSkyMode) {
    // Below-horizon is already hidden by the horizon-circle canvas clip; this
    // just skips the projection/size work for it earlier.
    if (moonAltDeg !== null && moonAltDeg < 0) return;
  } else if (outsideDecPrefilter(s, decDeg)) {
    return;
  }

  // The Moon's RA/Dec changes continuously, so it's projected directly (not via
  // projectCached, which is keyed on the hemisphere/mode generation and would go stale).
  const p = project(raDeg, decDeg);
  if (p.x >= 1e5) return; // far hemisphere (fisheye) / below horizon (zenith fisheye)
  const c = toCanvas(p.x, p.y, view);
  if (c.x < -50 || c.x > view.width + 50 || c.y < -50 || c.y > view.height + 50) return;

  const cos2 =
    s.localSkyMode && moonAltDeg !== null
      ? Math.cos(((90 - moonAltDeg) * DEG2RAD) / 2) ** 2
      : undefined;
  // 15 arcmin ≈ half the Moon's true ~30' diameter; floored so it reads as a disk
  // (not a speck) at typical zoom levels, same floor pattern as DSO marker sizing.
  const r = Math.max(7, angularSizeToCanvasPx(15, decDeg, view.scale, cos2));

  const belowHorizon = moonAltDeg !== null && moonAltDeg < 0;

  ctx.save();
  ctx.globalAlpha = belowHorizon ? s.belowHorizonAlpha : 1;
  drawMoonMarker(ctx, c.x, c.y, r, phaseIndex, {
    litFill: theme.moonLitColor,
    shadowFill: theme.moonShadowColor,
    outline: theme.moonOutlineColor,
  });
  ctx.restore();
}

export function planetLabelKey(planet: PlanetKey): string {
  return `planets.${planet}`;
}

export function planetColor(planet: PlanetKey, theme: SkyThemeConfig): string {
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
function renderCelestialBody(
  s: SkyScene,
  raDeg: number,
  decDeg: number,
  radiusPx: number,
  fillColor: string,
  label: string,
): void {
  const { ctx, view, horizon, theme } = s;
  const altDeg = horizon
    ? altAzFromRaDec(raDeg, decDeg, horizon.lstH, horizon.latDeg).altDeg
    : null;

  if (s.localSkyMode) {
    if (altDeg !== null && altDeg < 0) return;
  } else if (outsideDecPrefilter(s, decDeg)) {
    return;
  }

  const p = project(raDeg, decDeg);
  if (p.x >= 1e5) return;
  const c = toCanvas(p.x, p.y, view);
  if (c.x < -50 || c.x > view.width + 50 || c.y < -50 || c.y > view.height + 50) return;

  const belowHorizon = altDeg !== null && altDeg < 0;

  ctx.save();
  ctx.globalAlpha = belowHorizon ? s.belowHorizonAlpha : 1;
  drawBodyMarker(ctx, c.x, c.y, radiusPx, fillColor, theme.bodyOutlineColor);
  drawBodyLabel(ctx, c.x, c.y, radiusPx, label, theme.bodyLabelColor, FONTS.bodyLabel);
  ctx.restore();
}

export function renderSun(s: SkyScene): void {
  const date = s.skyTimeMode === 'live' ? new Date() : s.simDate;
  const jd = dateToJD(date);
  const { raDeg, decDeg } = sunRaDecDeg(jd);
  renderCelestialBody(s, raDeg, decDeg, SUN_RADIUS_PX, s.theme.sunColor, t('planets.sun'));
}

export function renderPlanets(s: SkyScene): void {
  const date = s.skyTimeMode === 'live' ? new Date() : s.simDate;
  const jd = dateToJD(date);
  for (const planet of PLANET_KEYS) {
    const { raDeg, decDeg } = planetRaDecDeg(jd, planet);
    renderCelestialBody(
      s,
      raDeg,
      decDeg,
      PLANET_RADIUS_PX,
      planetColor(planet, s.theme),
      t(planetLabelKey(planet)),
    );
  }
}
