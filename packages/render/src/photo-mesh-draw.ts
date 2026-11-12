/**
 * Draws a photo on a 2D canvas through its mesh (see `computePhotoCanvasMesh`): each cell as two triangles, each
 * triangle an affine piece of the picture. Slow for every frame of the map (the map draws with WebGL), fine for a
 * one-off drawing such as the map export.
 */
import type { Point } from '@myastrosky/core/types';

/**
 * Draws `image` (any size: the photo's pixels are scaled to it) of a `width` × `height` photo onto `ctx` so that the
 * photo's grid point (i, j) lands on `points[j·(n+1) + i]` (canvas pixels, before `ctx`'s own transform).
 */
export function drawImageMesh(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  width: number,
  height: number,
  mesh: { n: number; points: Point[] },
): void {
  const { n, points } = mesh;
  const base = ctx.getTransform();
  const at = (i: number, j: number) => ({
    u: (width * i) / n,
    v: (height * j) / n,
    q: points[j * (n + 1) + i],
  });
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const tris = [
        [at(i, j), at(i + 1, j), at(i, j + 1)],
        [at(i + 1, j + 1), at(i, j + 1), at(i + 1, j)],
      ];
      for (const [a, b, c] of tris) {
        // Grow the triangle by half a pixel from its centre so neighbouring triangles leave no hairline between them.
        const gx = (a.q.x + b.q.x + c.q.x) / 3;
        const gy = (a.q.y + b.q.y + c.q.y) / 3;
        const grow = (p: Point) => {
          const d = Math.hypot(p.x - gx, p.y - gy) || 1;
          return { x: p.x + ((p.x - gx) / d) * 0.5, y: p.y + ((p.y - gy) / d) * 0.5 };
        };
        const [ga, gb, gc] = [grow(a.q), grow(b.q), grow(c.q)];
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(ga.x, ga.y);
        ctx.lineTo(gb.x, gb.y);
        ctx.lineTo(gc.x, gc.y);
        ctx.closePath();
        ctx.clip();
        // The affine map taking the triangle's photo pixels (u, v) to its canvas points.
        const du1 = b.u - a.u;
        const dv1 = b.v - a.v;
        const du2 = c.u - a.u;
        const dv2 = c.v - a.v;
        const det = du1 * dv2 - du2 * dv1;
        const m11 = ((b.q.x - a.q.x) * dv2 - (c.q.x - a.q.x) * dv1) / det;
        const m12 = ((c.q.x - a.q.x) * du1 - (b.q.x - a.q.x) * du2) / det;
        const m21 = ((b.q.y - a.q.y) * dv2 - (c.q.y - a.q.y) * dv1) / det;
        const m22 = ((c.q.y - a.q.y) * du1 - (b.q.y - a.q.y) * du2) / det;
        ctx.setTransform(base);
        ctx.transform(
          m11,
          m21,
          m12,
          m22,
          a.q.x - m11 * a.u - m12 * a.v,
          a.q.y - m21 * a.u - m22 * a.v,
        );
        ctx.drawImage(image, 0, 0, width, height);
        ctx.restore();
      }
    }
  }
}
