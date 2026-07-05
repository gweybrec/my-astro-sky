/**
 * Grid-based spatial hash for fast nearest-neighbor lookups in 2D projection space.
 * Items are stored in fixed-size cells. Queries check only nearby cells.
 */
export class SpatialIndex<T> {
  private cells = new Map<string, { item: T; x: number; y: number }[]>();
  private cellSize: number;

  // Populated cell-coordinate bounds. Query loops are clamped to these so their cost is
  // O(occupied cells), never O(query radius): a query radius far larger than the data
  // extent (e.g. the 1/scale viewport radius when zoomed way out) would otherwise scan a
  // huge box of provably-empty cells. Sentinels leave every loop empty until first insert.
  // See docs/dev/render-performance.md, Technique 5 addendum.
  private minCellX = Infinity;
  private maxCellX = -Infinity;
  private minCellY = Infinity;
  private maxCellY = -Infinity;

  constructor(cellSize: number) {
    this.cellSize = cellSize;
  }

  private key(cx: number, cy: number): string {
    return `${cx},${cy}`;
  }

  private cellCoord(v: number): number {
    return Math.floor(v / this.cellSize);
  }

  clear() {
    this.cells.clear();
    this.minCellX = Infinity;
    this.maxCellX = -Infinity;
    this.minCellY = Infinity;
    this.maxCellY = -Infinity;
  }

  insert(item: T, x: number, y: number) {
    const cx = this.cellCoord(x);
    const cy = this.cellCoord(y);
    if (cx < this.minCellX) this.minCellX = cx;
    if (cx > this.maxCellX) this.maxCellX = cx;
    if (cy < this.minCellY) this.minCellY = cy;
    if (cy > this.maxCellY) this.maxCellY = cy;
    const k = this.key(cx, cy);
    let bucket = this.cells.get(k);
    if (!bucket) {
      bucket = [];
      this.cells.set(k, bucket);
    }
    bucket.push({ item, x, y });
  }

  /**
   * Find the closest item within `radius` of (qx, qy).
   * Returns null if nothing is within range.
   */
  findNearest(qx: number, qy: number, radius: number): T | null {
    const minCx = Math.max(this.cellCoord(qx - radius), this.minCellX);
    const maxCx = Math.min(this.cellCoord(qx + radius), this.maxCellX);
    const minCy = Math.max(this.cellCoord(qy - radius), this.minCellY);
    const maxCy = Math.min(this.cellCoord(qy + radius), this.maxCellY);

    let best: T | null = null;
    let bestDist = radius * radius;

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const bucket = this.cells.get(this.key(cx, cy));
        if (!bucket) continue;
        for (const entry of bucket) {
          const dx = entry.x - qx;
          const dy = entry.y - qy;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestDist) {
            bestDist = d2;
            best = entry.item;
          }
        }
      }
    }

    return best;
  }

  /**
   * Collect every item within `radius` of (qx, qy), in arbitrary order. Like
   * {@link findAll} but without the distance sort — use when the caller only needs
   * the set (e.g. viewport culling), not nearest-first ordering.
   */
  collect(qx: number, qy: number, radius: number): T[] {
    const minCx = Math.max(this.cellCoord(qx - radius), this.minCellX);
    const maxCx = Math.min(this.cellCoord(qx + radius), this.maxCellX);
    const minCy = Math.max(this.cellCoord(qy - radius), this.minCellY);
    const maxCy = Math.min(this.cellCoord(qy + radius), this.maxCellY);

    const r2 = radius * radius;
    const out: T[] = [];
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const bucket = this.cells.get(this.key(cx, cy));
        if (!bucket) continue;
        for (const entry of bucket) {
          const dx = entry.x - qx;
          const dy = entry.y - qy;
          if (dx * dx + dy * dy <= r2) out.push(entry.item);
        }
      }
    }
    return out;
  }

  /**
   * Find all items within `radius` of (qx, qy), sorted by distance ascending.
   */
  findAll(qx: number, qy: number, radius: number): T[] {
    const minCx = Math.max(this.cellCoord(qx - radius), this.minCellX);
    const maxCx = Math.min(this.cellCoord(qx + radius), this.maxCellX);
    const minCy = Math.max(this.cellCoord(qy - radius), this.minCellY);
    const maxCy = Math.min(this.cellCoord(qy + radius), this.maxCellY);

    const r2 = radius * radius;
    const results: { item: T; dist2: number }[] = [];

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const bucket = this.cells.get(this.key(cx, cy));
        if (!bucket) continue;
        for (const entry of bucket) {
          const dx = entry.x - qx;
          const dy = entry.y - qy;
          const d2 = dx * dx + dy * dy;
          if (d2 <= r2) {
            results.push({ item: entry.item, dist2: d2 });
          }
        }
      }
    }

    results.sort((a, b) => a.dist2 - b.dist2);
    return results.map((r) => r.item);
  }
}
