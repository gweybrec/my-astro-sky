/**
 * Canvas star drawing, extracted from `sky-map.ts`. `computeStarPaint` (the pure
 * size/colour/glow maths) lives in `star-render-math.ts`; this is the imperative
 * `ctx` half: painting a resolved {@link StarPaint} and baking it into an offscreen
 * sprite for the atlas. Not unit-tested (canvas).
 */
import type { StarPaint } from './star-render-math';

/**
 * Paint a single star at (cx, cy). A one-gradient opaque-core→halo for glowing stars,
 * else an opaque core with a soft rim. Used both to fill a sprite (cx=cy=half) and to
 * draw the highlighted / glow stars live.
 */
export function paintStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  p: StarPaint,
): void {
  if (p.glowAlpha > 0.01) {
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, p.glowR);
    grad.addColorStop(0, `rgba(${p.r}, ${p.g}, ${p.b}, 1)`);
    grad.addColorStop(p.solidUntil, `rgba(${p.r}, ${p.g}, ${p.b}, 1)`);
    const GLOW_STEPS = 12;
    for (let i = 0; i <= GLOW_STEPS; i++) {
      const f = i / GLOW_STEPS;
      const stop = p.coreEdge + (1 - p.coreEdge) * f;
      const a = p.glowAlpha * Math.pow(1 - f, 2.5);
      grad.addColorStop(stop, `rgba(${p.gr}, ${p.gg}, ${p.gb}, ${a})`);
    }
    ctx.fillStyle = grad;
    ctx.fillRect(cx - p.glowR, cy - p.glowR, p.glowR * 2, p.glowR * 2);
  } else {
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, p.radius);
    grad.addColorStop(0, `rgba(${p.r}, ${p.g}, ${p.b}, 1)`);
    grad.addColorStop(1 - p.soft, `rgba(${p.r}, ${p.g}, ${p.b}, 1)`);
    grad.addColorStop(1, `rgba(${p.r}, ${p.g}, ${p.b}, 0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(cx - p.radius, cy - p.radius, p.radius * 2, p.radius * 2);
  }
}

/** Render one star's sprite (centred) into an offscreen canvas sized to its extent. */
export function buildStarSprite(paint: StarPaint): { canvas: HTMLCanvasElement; half: number } {
  const extent = paint.glowAlpha > 0.01 ? paint.glowR : paint.radius;
  const half = Math.ceil(extent) + 1; // +1px so the soft rim isn't clipped
  const canvas = document.createElement('canvas');
  canvas.width = half * 2;
  canvas.height = half * 2;
  const sctx = canvas.getContext('2d')!;
  paintStar(sctx, half, half, paint);
  return { canvas, half };
}
