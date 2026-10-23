/**
 * Shared Moon phase glyph geometry: lit limb is a semicircle + terminator
 * ellipse; waning phases mirror the waxing geometry. Northern-hemisphere
 * convention (waxing lit on the right). Colors are parameterized so the dark
 * sky-map theme and the light PDF export can each pass their own palette while
 * sharing the same drawing math.
 */

export interface MoonMarkerColors {
  /** Illuminated portion of the disk. */
  litFill: string;
  /** Unlit (shadowed) portion of the disk. */
  shadowFill: string;
  /** Outline stroke around the disk. */
  outline: string;
}

export function drawMoonMarker(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  phaseIndex: number,
  colors: MoonMarkerColors,
  lineWidth = 1,
): void {
  const f = [0, 0.25, 0.5, 0.75, 1, 0.75, 0.5, 0.25][phaseIndex] ?? 0.5;
  const waning = phaseIndex >= 5;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = colors.shadowFill;
  ctx.fill();
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = colors.outline;

  if (f > 0.001) {
    ctx.save();
    ctx.translate(cx, cy);
    if (waning) ctx.scale(-1, 1); // mirror to put the lit limb on the left
    ctx.beginPath();
    ctx.fillStyle = colors.litFill;
    if (f >= 0.999) {
      ctx.arc(0, 0, r, 0, Math.PI * 2);
    } else {
      const b = r * (1 - 2 * f); // terminator x-radius (signed)
      ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false); // right limb, top→bottom
      ctx.ellipse(0, 0, Math.abs(b), r, 0, Math.PI / 2, -Math.PI / 2, b > 0); // terminator, bottom→top
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Outline last, so the white lit fill never paints over the disk edge.
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
