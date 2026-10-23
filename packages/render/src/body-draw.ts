/**
 * Shared canvas marker for the Sun and planets: a plain filled/stroked dot with
 * an optional name label. The Moon keeps its own phase-glyph drawing in
 * moon-draw.ts — these bodies are rendered as point-like markers instead.
 */

export function drawBodyMarker(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  fillColor: string,
  outlineColor: string,
  lineWidth = 1,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = outlineColor;
  ctx.stroke();
  ctx.restore();
}

export function drawBodyLabel(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  text: string,
  color: string,
  font: string,
): void {
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx + r + 4, cy);
  ctx.restore();
}
