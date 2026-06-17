import type { DSO, ViewState } from './types';
import { getHemisphere } from './projection';

const DEG2RAD = Math.PI / 180;

export const MIN_HIGHLIGHT_AXIS_PX = 7;

/** Same angular-size mapping used in sky-map DSO rendering. */
export function angularSizeToCanvasPxForDSO(arcmin: number, decDeg: number, scale: number): number {
  const colatitude = getHemisphere() === 'south' ? 90 + decDeg : 90 - decDeg;
  const theta = colatitude * DEG2RAD;
  const cos2 = Math.cos(theta / 2) ** 2;
  const rad = (arcmin / 60) * DEG2RAD;
  return (rad / (2 * cos2)) * scale;
}

/** Same PA-to-canvas angle transform used in sky-map DSO rendering. */
export function dsoCanvasAngleForHighlight(paDeg: number | null, raDeg: number, viewRotationDeg: number): number {
  const raRad = raDeg * DEG2RAD;
  const northAngle = Math.atan2(Math.cos(raRad), -Math.sin(raRad));
  return northAngle - (paDeg ?? 0) * DEG2RAD + viewRotationDeg * DEG2RAD;
}

/**
 * Inverse of {@link dsoCanvasAngleForHighlight}: given the on-screen (canvas) rotation
 * angle of a frame anchored at `raDeg` under map rotation `viewRotationDeg`, recover the
 * celestial position angle in degrees east of north, normalised to [0, 360).
 */
export function canvasAngleToPADeg(canvasAngle: number, raDeg: number, viewRotationDeg: number): number {
  const raRad = raDeg * DEG2RAD;
  const northAngle = Math.atan2(Math.cos(raRad), -Math.sin(raRad));
  let pa = (northAngle + viewRotationDeg * DEG2RAD - canvasAngle) / DEG2RAD;
  pa = ((pa % 360) + 360) % 360;
  return pa;
}

export interface DSOHighlightShape {
  rx: number;
  ry: number;
  angle: number;
}

/**
 * Compute highlight ellipse geometry with independent per-axis clamp.
 * When zooming out, a thin object keeps shrinking on its major axis while
 * the minor axis stays floored, then eventually both axes floor to a circle.
 */
export function computeDSOHighlightShape(
  dso: Pick<DSO, 'majAxis' | 'minAxis' | 'dec' | 'pa' | 'ra'>,
  view: Pick<ViewState, 'scale' | 'rotationDeg'>,
  minAxisPx = MIN_HIGHLIGHT_AXIS_PX,
): DSOHighlightShape {
  const majorArcmin = dso.majAxis ?? 1;
  const minorArcmin = dso.minAxis ?? majorArcmin;
  const rawRx = angularSizeToCanvasPxForDSO(majorArcmin / 2, dso.dec, view.scale);
  const rawRy = angularSizeToCanvasPxForDSO(minorArcmin / 2, dso.dec, view.scale);

  return {
    rx: Math.max(rawRx, minAxisPx),
    ry: Math.max(rawRy, minAxisPx),
    angle: dsoCanvasAngleForHighlight(dso.pa, dso.ra, view.rotationDeg),
  };
}
