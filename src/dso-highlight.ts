import type { DSO, ViewState } from './types';
import { getHemisphere } from './projection';
import { paToCanvasAngle, canvasPxPerDeg } from './sky-axes';

const DEG2RAD = Math.PI / 180;

export const MIN_HIGHLIGHT_AXIS_PX = 7;

/**
 * Same angular-size mapping used in sky-map DSO rendering.
 *
 * The `1/(2cos²((90∓dec)/2))` factor is the local scale of the **pole-centred**
 * stereographic map. Callers that may run while the projection is zenith-centred should
 * prefer {@link canvasPxPerDeg}, which measures the active projection instead; this is
 * kept for the plan/target-chart export, which frames its own pole-centred view.
 */
export function angularSizeToCanvasPxForDSO(arcmin: number, decDeg: number, scale: number): number {
  const colatitude = getHemisphere() === 'south' ? 90 + decDeg : 90 - decDeg;
  const theta = colatitude * DEG2RAD;
  const cos2 = Math.cos(theta / 2) ** 2;
  const rad = (arcmin / 60) * DEG2RAD;
  return (rad / (2 * cos2)) * scale;
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
 *
 * Size and angle both come from the *active* projection (see `sky-axes.ts`), so the ring
 * tracks the object in the Local Sky dome as well as the pole-centred map. This runs once
 * per render for the single highlighted object, so the uncached measurement is free.
 */
export function computeDSOHighlightShape(
  dso: Pick<DSO, 'majAxis' | 'minAxis' | 'dec' | 'pa' | 'ra'>,
  view: Pick<ViewState, 'scale' | 'rotationDeg'>,
  minAxisPx = MIN_HIGHLIGHT_AXIS_PX,
): DSOHighlightShape {
  const majorArcmin = dso.majAxis ?? 1;
  const minorArcmin = dso.minAxis ?? majorArcmin;
  // px/° measured from the active projection. In the pole-centred map this equals the
  // closed form above to floating-point noise (it is its exact derivative), so the default
  // view is unchanged; in zenith mode it keys on altitude instead of dec, which is the fix.
  const pxPerDeg = canvasPxPerDeg(dso.ra, dso.dec, view);
  const rawRx = (majorArcmin / 60 / 2) * pxPerDeg;
  const rawRy = (minorArcmin / 60 / 2) * pxPerDeg;

  return {
    rx: Math.max(rawRx, minAxisPx),
    ry: Math.max(rawRy, minAxisPx),
    angle: paToCanvasAngle(dso.pa ?? 0, dso.ra, dso.dec, view),
  };
}
