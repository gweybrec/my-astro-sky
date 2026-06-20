import { describe, expect, it } from 'vitest';
import { planGrid, tileCenters, mosaicBounds, autoRegionForDso, autoRegionForDsos, framePointToSky, skyToFrameOffset, mosaicShapeFromOffsets, addCandidateOffsets, smartMosaicEnvelope, clampSmartMosaicSize, outlineFromGrid, transformMosaicToSetup } from '../../src/mosaic';

/** True if a list of offsets contains one ≈(gx, gy). */
function hasOffset(list: Array<{ gx: number; gy: number }>, gx: number, gy: number): boolean {
  return list.some(o => Math.abs(o.gx - gx) < 1e-9 && Math.abs(o.gy - gy) < 1e-9);
}

/** Angular separation (deg) between two sky points, via the haversine formula. */
function sep(a: { ra: number; dec: number }, b: { ra: number; dec: number }): number {
  const d2r = Math.PI / 180;
  const dLat = (b.dec - a.dec) * d2r;
  const dLon = (b.ra - a.ra) * d2r;
  const la1 = a.dec * d2r;
  const la2 = b.dec * d2r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h))) / d2r;
}

describe('planGrid', () => {
  it('uses a single tile when the region fits in one frame', () => {
    expect(planGrid(2, 1.5, 1.5, 1, 20)).toEqual({ cols: 1, rows: 1 });
    expect(planGrid(2, 1.5, 2, 1.5, 20)).toEqual({ cols: 1, rows: 1 });
  });

  it('adds tiles as the region grows past one frame', () => {
    // 1° tiles, 0% overlap: a 3° region needs 3 tiles.
    expect(planGrid(1, 1, 3, 3, 0)).toEqual({ cols: 3, rows: 3 });
    // Just over 2 tiles → 3 tiles.
    expect(planGrid(1, 1, 2.1, 2.1, 0)).toEqual({ cols: 3, rows: 3 });
  });

  it('needs more tiles as overlap increases (smaller effective step)', () => {
    const none = planGrid(1, 1, 3, 1, 0).cols;
    const lots = planGrid(1, 1, 3, 1, 50).cols;
    expect(lots).toBeGreaterThan(none);
  });

  it('treats width as columns and height as rows independently', () => {
    expect(planGrid(1, 1, 4, 1, 0)).toEqual({ cols: 4, rows: 1 });
  });
});

describe('tileCenters', () => {
  const center = { ra: 50, dec: 20 };

  it('produces cols×rows tiles each carrying the mosaic PA and grid cell', () => {
    const tiles = tileCenters(center, 0, 3, 2, 1, 1, 20);
    expect(tiles).toHaveLength(6);
    expect(tiles.every(t => t.paDeg === 0)).toBe(true);
    expect(new Set(tiles.map(t => `${t.row},${t.col}`)).size).toBe(6);
  });

  it('places the grid centre tile at the mosaic centre for an odd grid', () => {
    const tiles = tileCenters(center, 0, 3, 3, 1, 1, 0);
    const mid = tiles.find(t => t.row === 1 && t.col === 1)!;
    expect(sep(mid, center)).toBeLessThan(1e-6);
  });

  it('spaces adjacent tiles by tile·(1−overlap) along each axis', () => {
    const overlap = 20;
    const step = 1 * (1 - overlap / 100); // 0.8°
    const tiles = tileCenters(center, 0, 3, 3, 1, 1, overlap);
    const at = (r: number, c: number) => tiles.find(t => t.row === r && t.col === c)!;
    // Horizontal neighbours (same row) — separation ≈ step.
    expect(sep(at(1, 0), at(1, 1))).toBeCloseTo(step, 2);
    // Vertical neighbours (same col) — separation ≈ step.
    expect(sep(at(0, 1), at(1, 1))).toBeCloseTo(step, 2);
  });

  it('rotating the mosaic by PA keeps tile separations identical', () => {
    const flat = tileCenters(center, 0, 2, 2, 1, 1, 10);
    const rot = tileCenters(center, 35, 2, 2, 1, 1, 10);
    const sFlat = sep(flat.find(t => t.row === 0 && t.col === 0)!, flat.find(t => t.row === 0 && t.col === 1)!);
    const sRot = sep(rot.find(t => t.row === 0 && t.col === 0)!, rot.find(t => t.row === 0 && t.col === 1)!);
    expect(sRot).toBeCloseTo(sFlat, 4);
  });

  it('stays finite and bounded near the celestial pole', () => {
    const tiles = tileCenters({ ra: 0, dec: 88 }, 0, 3, 3, 1, 1, 10);
    for (const t of tiles) {
      expect(Number.isFinite(t.ra)).toBe(true);
      expect(Number.isFinite(t.dec)).toBe(true);
      expect(t.dec).toBeLessThanOrEqual(90);
      expect(t.ra).toBeGreaterThanOrEqual(0);
      expect(t.ra).toBeLessThan(360);
    }
  });
});

describe('mosaicBounds', () => {
  it('returns zero for an empty tile set', () => {
    expect(mosaicBounds([], 1, 1, 20)).toEqual({ wDeg: 0, hDeg: 0 });
  });

  it('spans (n−1)·step + tile across the grid', () => {
    const tiles = [
      { row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 },
      { row: 1, col: 0 }, { row: 1, col: 1 }, { row: 1, col: 2 },
    ];
    // 1° tiles, 20% overlap → step 0.8. cols span 2 → 2*0.8 + 1 = 2.6; rows span 1 → 1*0.8 + 1 = 1.8.
    expect(mosaicBounds(tiles, 1, 1, 20)).toEqual({ wDeg: 2.6, hDeg: 1.8 });
  });

  it('uses the bounding cells of a non-rectangular union', () => {
    const tiles = [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 1, col: 0 }];
    const b = mosaicBounds(tiles, 1, 1, 0);
    expect(b).toEqual({ wDeg: 2, hDeg: 2 });
  });
});

describe('autoRegionForDso', () => {
  it('pads the catalogued axes by the margin and aligns PA with the major axis', () => {
    // 60′ major, 30′ minor, PA 45°, 20% margin → height 1.2°, width 0.6°.
    const r = autoRegionForDso({ majAxis: 60, minAxis: 30, pa: 45 }, 20);
    expect(r.hDeg).toBeCloseTo(1.2, 6);
    expect(r.wDeg).toBeCloseTo(0.6, 6);
    expect(r.paDeg).toBe(45);
  });

  it('falls back to minor = major when minAxis is null', () => {
    const r = autoRegionForDso({ majAxis: 30, minAxis: null, pa: 0 }, 0);
    expect(r.wDeg).toBeCloseTo(0.5, 6);
    expect(r.hDeg).toBeCloseTo(0.5, 6);
  });

  it('returns a zero region (→ single tile) when the object has no size', () => {
    const r = autoRegionForDso({ majAxis: null, minAxis: null, pa: 10 }, 20);
    expect(r).toEqual({ wDeg: 0, hDeg: 0, paDeg: 10 });
    expect(planGrid(1, 1, r.wDeg, r.hDeg, 20)).toEqual({ cols: 1, rows: 1 });
  });
});

describe('autoRegionForDsos', () => {
  it('reduces to autoRegionForDso centred on the object for a single DSO', () => {
    const dso = { ra: 83.8, dec: -5.4, majAxis: 60, minAxis: 30, pa: 45 };
    const out = autoRegionForDsos([dso], 20);
    expect(out.center).toEqual({ ra: dso.ra, dec: dso.dec });
    expect(out.region).toEqual(autoRegionForDso(dso, 20));
  });

  it('places the centre between two targets and un-anchors (PA 0)', () => {
    const a = { ra: 83.0, dec: 0, majAxis: null, minAxis: null, pa: 0 };
    const b = { ra: 84.0, dec: 0, majAxis: null, minAxis: null, pa: 0 };
    const out = autoRegionForDsos([a, b], 20);
    expect(out.center.ra).toBeCloseTo(83.5, 4);
    expect(out.center.dec).toBeCloseTo(0, 4);
    expect(out.region.paDeg).toBe(0);
    // ~1° apart in RA at dec 0, padded by 20% → region wider than the raw span.
    expect(out.region.wDeg).toBeGreaterThan(1);
    // Centre is (near-)equidistant from both targets (gnomonic ⇒ approximate).
    expect(sep(out.center, a)).toBeCloseTo(sep(out.center, b), 3);
  });

  it('grows the region to enclose each target plus its angular size', () => {
    const small = autoRegionForDsos([
      { ra: 10, dec: 30, majAxis: null, minAxis: null, pa: 0 },
      { ra: 10.5, dec: 30, majAxis: null, minAxis: null, pa: 0 },
    ], 0);
    const big = autoRegionForDsos([
      { ra: 10, dec: 30, majAxis: 120, minAxis: 120, pa: 0 },
      { ra: 10.5, dec: 30, majAxis: 120, minAxis: 120, pa: 0 },
    ], 0);
    expect(big.region.wDeg).toBeGreaterThan(small.region.wDeg);
  });
});

describe('framePointToSky', () => {
  const center = { ra: 80, dec: 0 };

  it('returns the centre for a zero offset', () => {
    const p = framePointToSky(center, 0, 0, 0);
    expect(p.ra).toBeCloseTo(80, 6);
    expect(p.dec).toBeCloseTo(0, 6);
  });

  it('moves "up" (gy) toward the north at PA 0', () => {
    const p = framePointToSky(center, 0, 0, 1);
    expect(p.dec).toBeCloseTo(1, 3);          // +1° north
    expect(p.ra).toBeCloseTo(80, 3);          // RA unchanged on the meridian
    expect(sep(p, center)).toBeCloseTo(1, 3); // 1° away
  });

  it('moves "right" (gx) toward the east at PA 0', () => {
    const p = framePointToSky(center, 0, 1, 0);
    expect(p.ra).toBeGreaterThan(80);         // toward increasing RA (east)
    expect(p.dec).toBeCloseTo(0, 3);
    expect(sep(p, center)).toBeCloseTo(1, 3);
  });

  it('PA rotates the frame: up at PA 90 goes the same way as right at PA 0', () => {
    const up90 = framePointToSky(center, 90, 0, 1);
    const right0 = framePointToSky(center, 0, 1, 0);
    expect(sep(up90, right0)).toBeLessThan(1e-6);
  });

  it('matches the layout tileCenters uses (a single tile sits at the centre)', () => {
    const [tile] = tileCenters(center, 35, 1, 1, 1, 1, 20);
    const p = framePointToSky(center, 35, 0, 0);
    expect(sep(p, tile)).toBeLessThan(1e-9);
  });

  it('places the centre of a tile at its grid offset', () => {
    // 3×1 grid, 0% overlap, 1° tiles, PA 0: the right tile centre sits +1° east.
    const tiles = tileCenters(center, 0, 3, 1, 1, 1, 0);
    const right = tiles.find(t => t.col === 2 && t.row === 0)!;
    const expected = framePointToSky(center, 0, 1, 0); // col offset = +1 step
    expect(sep(right, expected)).toBeLessThan(1e-9);
  });
});

describe('skyToFrameOffset', () => {
  it('round-trips with framePointToSky for many offsets, centres and PAs', () => {
    const centres = [{ ra: 80, dec: 0 }, { ra: 10.68, dec: 41.27 }, { ra: 200, dec: -60 }, { ra: 0, dec: 80 }];
    for (const center of centres) {
      for (const paDeg of [0, 35, 90, -120, 200]) {
        for (const [gx, gy] of [[0, 0], [1, 0], [0, 1.5], [-2, 1], [1.3, -0.7], [-1.8, -2.4]]) {
          const s = framePointToSky(center, paDeg, gx, gy);
          const back = skyToFrameOffset(center, paDeg, s.ra, s.dec);
          expect(back.gx).toBeCloseTo(gx, 6);
          expect(back.gy).toBeCloseTo(gy, 6);
        }
      }
    }
  });

  it('a zero offset maps back to (0, 0)', () => {
    const o = skyToFrameOffset({ ra: 50, dec: 20 }, 35, 50, 20);
    expect(o.gx).toBeCloseTo(0, 9);
    expect(o.gy).toBeCloseTo(0, 9);
  });
});

describe('mosaicShapeFromOffsets', () => {
  it('measures the tight grid and centroid of a centred set', () => {
    // 2 cols × 3 rows on a 0.8 step lattice, centred on the origin.
    const offs = [
      { gx: -0.4, gy: -0.8 }, { gx: 0.4, gy: -0.8 },
      { gx: -0.4, gy: 0 }, { gx: 0.4, gy: 0 },
      { gx: -0.4, gy: 0.8 }, { gx: 0.4, gy: 0.8 },
    ];
    const s = mosaicShapeFromOffsets(offs, 0.8, 0.8);
    expect(s.cols).toBe(2);
    expect(s.rows).toBe(3);
    expect(s.centerGx).toBeCloseTo(0, 9);
    expect(s.centerGy).toBeCloseTo(0, 9);
  });

  it('reports the bbox centre off-origin when an edge is trimmed (the recenter shift)', () => {
    // Drop the top row of the set above → 2×2 remains, its centre shifts down by
    // half a step (so the mosaic centre must move there to stay aligned).
    const offs = [
      { gx: -0.4, gy: 0 }, { gx: 0.4, gy: 0 },
      { gx: -0.4, gy: 0.8 }, { gx: 0.4, gy: 0.8 },
    ];
    const s = mosaicShapeFromOffsets(offs, 0.8, 0.8);
    expect(s.cols).toBe(2);
    expect(s.rows).toBe(2);
    expect(s.centerGx).toBeCloseTo(0, 9);
    expect(s.centerGy).toBeCloseTo(0.4, 9); // midpoint of 0 and 0.8
  });

  it('a single remaining tile recentres exactly onto it', () => {
    const s = mosaicShapeFromOffsets([{ gx: 1.3, gy: -0.7 }], 0.8, 0.8);
    expect(s).toEqual({ centerGx: 1.3, centerGy: -0.7, cols: 1, rows: 1 });
  });

  it('returns a zero shape for no offsets', () => {
    expect(mosaicShapeFromOffsets([], 0.8, 0.8)).toEqual({ centerGx: 0, centerGy: 0, cols: 0, rows: 0 });
  });
});

describe('addCandidateOffsets', () => {
  it('a single tile has four neighbours', () => {
    const c = addCandidateOffsets([{ gx: 0, gy: 0 }], 0.8, 0.8);
    expect(c).toHaveLength(4);
    expect(hasOffset(c, 0.8, 0)).toBe(true);
    expect(hasOffset(c, -0.8, 0)).toBe(true);
    expect(hasOffset(c, 0, 0.8)).toBe(true);
    expect(hasOffset(c, 0, -0.8)).toBe(true);
  });

  it('a 2×2 block exposes its 8 perimeter neighbours and no interior duplicates', () => {
    const block = [
      { gx: 0, gy: 0 }, { gx: 0.8, gy: 0 },
      { gx: 0, gy: 0.8 }, { gx: 0.8, gy: 0.8 },
    ];
    const c = addCandidateOffsets(block, 0.8, 0.8);
    expect(c).toHaveLength(8);
    // Existing cells are never candidates.
    expect(hasOffset(c, 0, 0)).toBe(false);
    expect(hasOffset(c, 0.8, 0.8)).toBe(false);
    // A couple of the expected perimeter spots.
    expect(hasOffset(c, -0.8, 0)).toBe(true);
    expect(hasOffset(c, 1.6, 0.8)).toBe(true);
  });

  it('offers the gap of an L-shape (re-fill a removed corner)', () => {
    // Full 2×2 minus the top-right corner → the gap at (0.8, 0.8) is a candidate.
    const lshape = [{ gx: 0, gy: 0 }, { gx: 0.8, gy: 0 }, { gx: 0, gy: 0.8 }];
    expect(hasOffset(addCandidateOffsets(lshape, 0.8, 0.8), 0.8, 0.8)).toBe(true);
  });

  it('returns nothing for an empty set', () => {
    expect(addCandidateOffsets([], 0.8, 0.8)).toEqual([]);
  });
});

describe('smartMosaicEnvelope', () => {
  it('returns null when the scope has no mosaic capability', () => {
    expect(smartMosaicEnvelope(undefined, 1, 2)).toBeNull();
    expect(smartMosaicEnvelope(null, 1, 2)).toBeNull();
    expect(smartMosaicEnvelope({}, 1, 2)).toBeNull();
  });

  it('scales the native FOV per axis for a multiplier scope (Seestar 2×)', () => {
    // Seestar S50 native ≈ 0.73° × 1.28°; 2× per axis.
    const env = smartMosaicEnvelope({ scale: 2 }, 1.28, 0.73);
    expect(env).not.toBeNull();
    expect(env!.maxWDeg).toBeCloseTo(2.56, 6);
    expect(env!.maxHDeg).toBeCloseTo(1.46, 6);
    expect(env!.maxAreaDeg2).toBeUndefined(); // no area coupling for multiplier scopes
  });

  it('uses an equal-axis long edge + area cap for an area-coupled scope (Vespera)', () => {
    const env = smartMosaicEnvelope({ max_long_edge_deg: 4.33, max_area_deg2: 10.5 }, 2.5, 1.4);
    expect(env).toEqual({ maxWDeg: 4.33, maxHDeg: 4.33, maxAreaDeg2: 10.5 });
  });

  it('ignores a scale of 1 or less (no enlargement → no mosaic)', () => {
    expect(smartMosaicEnvelope({ scale: 1 }, 1, 2)).toBeNull();
  });
});

describe('clampSmartMosaicSize', () => {
  it('floors each axis at the native FOV', () => {
    const env = smartMosaicEnvelope({ scale: 2 }, 1.28, 0.73)!;
    const r = clampSmartMosaicSize(0.5, 0.2, 1.28, 0.73, env);
    expect(r.wDeg).toBeCloseTo(1.28, 6);
    expect(r.hDeg).toBeCloseTo(0.73, 6);
  });

  it('caps each axis at its per-axis maximum (multiplier scope)', () => {
    const env = smartMosaicEnvelope({ scale: 2 }, 1.28, 0.73)!;
    const r = clampSmartMosaicSize(5, 5, 1.28, 0.73, env);
    expect(r.wDeg).toBeCloseTo(2.56, 6);
    expect(r.hDeg).toBeCloseTo(1.46, 6);
  });

  // Vespera II envelope: square (3.25²) and rectangle (4.33×2.43) both fit.
  const AREA = 10.56;
  const vesperaII = () => smartMosaicEnvelope({ max_long_edge_deg: 4.33, max_area_deg2: AREA }, 2.5, 1.4)!;

  it('allows a square mosaic that stays within the area cap', () => {
    const r = clampSmartMosaicSize(3.0, 3.0, 2.5, 1.4, vesperaII());
    expect(r.wDeg).toBeCloseTo(3.0, 6);
    expect(r.hDeg).toBeCloseTo(3.0, 6); // 9 deg² < area cap → untouched
  });

  it('shrinks the perpendicular axis when one edge is pushed past the square (area cap)', () => {
    // Drag the width out to the long edge: height collapses to hold the area.
    const r = clampSmartMosaicSize(4.33, 3.0, 2.5, 1.4, vesperaII());
    expect(r.wDeg).toBeCloseTo(4.33, 6);          // dragged (larger) axis kept
    expect(r.hDeg).toBeCloseTo(AREA / 4.33, 6);   // ≈ 2.44° — perpendicular shrunk
    expect(r.wDeg * r.hDeg).toBeLessThanOrEqual(AREA + 1e-9);
  });

  it('keeps the dragged axis whichever orientation (tall rectangle)', () => {
    // Square-ish native so the perpendicular axis can shrink freely (no floor clash).
    const env = smartMosaicEnvelope({ max_long_edge_deg: 4.33, max_area_deg2: AREA }, 1.5, 1.5)!;
    const r = clampSmartMosaicSize(3.0, 4.33, 1.5, 1.5, env);
    expect(r.hDeg).toBeCloseTo(4.33, 6);
    expect(r.wDeg).toBeCloseTo(AREA / 4.33, 6);
  });

  it('floors at the native FOV even if it slightly exceeds the area cap', () => {
    // When the native long axis alone forces the area over the cap, the floor wins.
    const r = clampSmartMosaicSize(9, 9, 2.5, 1.4, vesperaII());
    expect(r.wDeg).toBeGreaterThanOrEqual(2.5 - 1e-9);
    expect(r.hDeg).toBeGreaterThanOrEqual(1.4 - 1e-9);
  });
});

describe('outlineFromGrid', () => {
  it('returns the single-tile FOV for a 1×1 grid', () => {
    expect(outlineFromGrid(1, 1, 2, 1.5, 20)).toEqual({ wDeg: 2, hDeg: 1.5 });
  });

  it('spans (n−1)·step + tile across each axis', () => {
    // 1° tiles, 20% overlap → step 0.8. 3 cols → 2*0.8 + 1 = 2.6; 2 rows → 1*0.8 + 1 = 1.8.
    const o = outlineFromGrid(3, 2, 1, 1, 20);
    expect(o.wDeg).toBeCloseTo(2.6, 9);
    expect(o.hDeg).toBeCloseTo(1.8, 9);
  });

  it('inverts planGrid up to a one-tile rounding margin (closest whole-tile match)', () => {
    // Re-gridding an outline onto the same tile size recovers the grid, give or
    // take a single tile where the span lands exactly on a ceil() boundary (FP).
    for (const [cols, rows, overlap] of [[3, 2, 20], [4, 4, 0], [2, 5, 50], [1, 3, 30]]) {
      const o = outlineFromGrid(cols, rows, 1.3, 0.9, overlap);
      const g = planGrid(1.3, 0.9, o.wDeg, o.hDeg, overlap);
      expect(g.cols).toBeGreaterThanOrEqual(cols);
      expect(g.cols).toBeLessThanOrEqual(cols + 1);
      expect(g.rows).toBeGreaterThanOrEqual(rows);
      expect(g.rows).toBeLessThanOrEqual(rows + 1);
    }
  });
});

describe('transformMosaicToSetup', () => {
  const seestar = smartMosaicEnvelope({ scale: 2 }, 1.28, 0.73)!;
  const classical = (wDeg: number, hDeg: number): Parameters<typeof transformMosaicToSetup>[3] =>
    ({ wDeg, hDeg, envelope: null, tileable: true });
  const smart = (wDeg: number, hDeg: number, envelope = seestar): Parameters<typeof transformMosaicToSetup>[3] =>
    ({ wDeg, hDeg, envelope, tileable: false });

  it('classical → classical: re-grids the outline keeping overlap, outline ≈ preserved', () => {
    // Source outline of a 3×2 mosaic at 1°/20% overlap = 2.6° × 1.8°.
    const src = outlineFromGrid(3, 2, 1, 1, 20);
    // New scope has a smaller 0.7° × 0.5° tile → needs a denser grid.
    const r = transformMosaicToSetup(src.wDeg, src.hDeg, 20, classical(0.7, 0.5));
    expect(r.kind).toBe('grid');
    if (r.kind !== 'grid') return;
    expect(r.cols).toBeGreaterThan(3);
    expect(r.rows).toBeGreaterThan(2);
    // The re-gridded outline covers at least the source (closest whole-tile match).
    expect(r.wDeg).toBeGreaterThanOrEqual(src.wDeg - 1e-9);
    expect(r.hDeg).toBeGreaterThanOrEqual(src.hDeg - 1e-9);
    expect(r.wDeg).toBeLessThan(src.wDeg + 0.7); // within one extra tile
  });

  it('classical → smart: clamps the outline into the envelope (single, ≥ native, ≤ max)', () => {
    const src = outlineFromGrid(4, 4, 1, 1, 20); // 3.4° × 3.4°, larger than the envelope
    const r = transformMosaicToSetup(src.wDeg, src.hDeg, 20, smart(1.28, 0.73));
    expect(r.kind).toBe('single');
    if (r.kind !== 'single') return;
    expect(r.wDeg).toBeCloseTo(2.56, 6); // capped at 2× native
    expect(r.hDeg).toBeCloseTo(1.46, 6);
    expect(r.wDeg).toBeGreaterThanOrEqual(1.28);
    expect(r.hDeg).toBeGreaterThanOrEqual(0.73);
  });

  it('smart → classical: tiles an enlarged single frame into a multi-tile grid', () => {
    // Enlarged Seestar frame 2.56° × 1.46° onto a 0.7° × 0.5° classical tile.
    const r = transformMosaicToSetup(2.56, 1.46, 20, classical(0.7, 0.5));
    expect(r.kind).toBe('grid');
    if (r.kind !== 'grid') return;
    expect(r.cols).toBeGreaterThan(1);
    expect(r.rows).toBeGreaterThan(1);
  });

  it('smart → smart: re-clamps the outline into the new envelope', () => {
    const vespera = smartMosaicEnvelope({ max_long_edge_deg: 4.33, max_area_deg2: 10.56 }, 2.5, 1.4)!;
    const r = transformMosaicToSetup(2.56, 1.46, 20, smart(2.5, 1.4, vespera));
    expect(r.kind).toBe('single');
    if (r.kind !== 'single') return;
    expect(r.wDeg).toBeGreaterThanOrEqual(2.5 - 1e-9); // floored at the new native
    expect(r.hDeg).toBeGreaterThanOrEqual(1.4 - 1e-9);
  });

  it('target smart scope with no mosaic mode → a single native frame', () => {
    const r = transformMosaicToSetup(3, 3, 20, { wDeg: 1.4, hDeg: 0.8, envelope: null, tileable: false });
    expect(r).toEqual({ kind: 'single', wDeg: 1.4, hDeg: 0.8 });
  });

  it('classical target with a sub-native outline collapses to a single native frame', () => {
    const r = transformMosaicToSetup(0.5, 0.4, 20, classical(2, 1.5));
    expect(r).toEqual({ kind: 'single', wDeg: 2, hDeg: 1.5 });
  });
});
