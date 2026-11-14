import type {
  Star,
  StarMultiplicity,
  ConstellationLine,
  ConstellationInfo,
  ConstellationStyle,
} from '../types';
import { normalizeRA } from '../angles';

let stars: Star[] = [];
let starsByHip = new Map<number, Star>();
let constellationInfos: ConstellationInfo[] = [];
// Raw curated multiple-star systems (HIP-keyed), retained for the Targets recommender.
let multipleSystems: Record<string, StarMultipleEntry> = {};
// Cached ascending magnitude list (brightest first), built lazily from `stars`.
// `stars` is itself kept sorted by magnitude, so this is just its `mag` column.
let starMagsSorted: number[] | null = null;

// Constellation lines are stored per style; 'western' is loaded eagerly at startup.
const constellationLinesByStyle = new Map<ConstellationStyle, ConstellationLine[]>();
// Per style, the magnitude of the star at each constellation-line vertex (see getConstellationVertexMags).
const vertexMagsByStyle = new Map<ConstellationStyle, number[][][]>();

/** Raw shape of a public/data/star-multiples.json entry. `members` lists the other
 *  component HIPs of the system (present in the catalog), which inherit the metadata.
 *  `magB`/`bvB` give the companion's photometry when it is NOT a catalogued member —
 *  used by the recommender's rating (see multiple-stars.ts). */
export interface StarMultipleEntry {
  components: number;
  sep?: string;
  members?: number[];
  magB?: number;
  bvB?: number;
}

// ─── Setters (called by the platform loader in src/star-catalog.ts) ──────────

/** Install the parsed star list (any order) and the raw curated multiple systems. */
export function setStarCatalog(
  newStars: Star[],
  newMultipleSystems: Record<string, StarMultipleEntry>,
): void {
  // Sort by magnitude (brightest first) for rendering priority
  stars = [...newStars].sort((a, b) => a.mag - b.mag);
  starsByHip = new Map(stars.map((s) => [s.hip, s]));
  multipleSystems = newMultipleSystems;
  starMagsSorted = null; // invalidate cache; rebuilt lazily on next access
  vertexMagsByStyle.clear();
}

export function setConstellationInfos(infos: ConstellationInfo[]): void {
  constellationInfos = infos;
}

export function setConstellationLines(style: ConstellationStyle, lines: ConstellationLine[]): void {
  constellationLinesByStyle.set(style, lines);
  vertexMagsByStyle.delete(style);
}

export function hasConstellationLines(style: ConstellationStyle): boolean {
  return constellationLinesByStyle.has(style);
}

// ─── Lookups ─────────────────────────────────────────────────────────────────

export function parseConstellationLines(linesData: any): ConstellationLine[] {
  const result: ConstellationLine[] = [];
  for (const f of linesData.features) {
    result.push({
      id: f.id,
      segments: f.geometry.coordinates.map((seg: number[][]) =>
        seg.map(([ra, dec]: number[]) => [normalizeRA(ra), dec] as [number, number]),
      ),
    });
  }
  return result;
}

export function getStars(): Star[] {
  return stars;
}

export function getStarByHip(hip: number): Star | undefined {
  return starsByHip.get(hip);
}

/**
 * Catalog magnitudes sorted ascending (brightest first), for the pan-invariant render
 * budget (see render-budget.ts). Built once and cached; `stars` is already mag-sorted.
 */
export function getStarMagsSorted(): number[] {
  if (!starMagsSorted) starMagsSorted = stars.map((s) => s.mag);
  return starMagsSorted;
}

export function getConstellationLines(style: ConstellationStyle = 'western'): ConstellationLine[] {
  return constellationLinesByStyle.get(style) ?? [];
}

/** Line vertices are catalog stars; only naked-eye ones are worth indexing for the match. */
const VERTEX_STAR_MAX_MAG = 7.5;
/** How far (degrees) a vertex may be from its catalog star (rounding, epoch). */
const VERTEX_MATCH_DEG = 0.15;

/**
 * The magnitude of the star at each vertex of a style's constellation lines, in the
 * same nesting as the lines (line → segment → vertex): the brightest catalog star
 * within {@link VERTEX_MATCH_DEG} of the vertex, or Infinity when none is found.
 * Built once per style (and again after the catalog changes). Used to leave a gap
 * the size of the drawn star where a line meets it.
 */
export function getConstellationVertexMags(style: ConstellationStyle = 'western'): number[][][] {
  const cached = vertexMagsByStyle.get(style);
  if (cached) return cached;
  const lines = getConstellationLines(style);

  // 1°-cell grid of the naked-eye stars (`stars` is brightest first, so is each cell).
  const cells = new Map<number, Star[]>();
  const key = (raCell: number, decCell: number) => ((raCell + 360) % 360) * 1000 + decCell + 90;
  for (const s of stars) {
    if (s.mag > VERTEX_STAR_MAX_MAG) break;
    const k = key(Math.floor(s.ra), Math.floor(s.dec));
    const list = cells.get(k);
    if (list) list.push(s);
    else cells.set(k, [s]);
  }

  const magAt = (ra: number, dec: number): number => {
    const cosDec = Math.max(0.01, Math.cos((dec * Math.PI) / 180));
    let best = Infinity;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dd = -1; dd <= 1; dd++) {
        const list = cells.get(key(Math.floor(ra) + dr, Math.floor(dec) + dd));
        if (!list) continue;
        for (const s of list) {
          if (s.mag >= best) break;
          let dRa = Math.abs(s.ra - ra);
          if (dRa > 180) dRa = 360 - dRa;
          if (Math.hypot(dRa * cosDec, s.dec - dec) <= VERTEX_MATCH_DEG) best = s.mag;
        }
      }
    }
    return best;
  };

  const mags = lines.map((line) =>
    line.segments.map((seg) => seg.map(([ra, dec]) => magAt(ra, dec))),
  );
  // Not cached before the catalog is in: it would stay all-Infinity.
  if (stars.length > 0) vertexMagsByStyle.set(style, mags);
  return mags;
}

export function getConstellationInfos(): ConstellationInfo[] {
  return constellationInfos;
}

export function getNamedStars(): Star[] {
  return stars.filter((s) => s.name || s.bayer);
}

/** Curated multiple-star systems (HIP-keyed), for the Targets recommender. */
export function getMultipleSystems(): Record<string, StarMultipleEntry> {
  return multipleSystems;
}

/**
 * Expand curated multiple-star systems into a per-HIP lookup: the metadata attaches to
 * the primary HIP and to each companion listed in `members`, so every component present
 * in the catalog surfaces it. Companion `members` are stripped from the attached object.
 */
export function expandMultiples(
  raw: Record<string, StarMultipleEntry>,
): Map<number, StarMultiplicity> {
  const map = new Map<number, StarMultiplicity>();
  for (const [hipStr, e] of Object.entries(raw)) {
    const meta: StarMultiplicity = { components: e.components };
    if (e.sep) meta.sep = e.sep;
    map.set(Number(hipStr), meta);
    for (const member of e.members ?? []) map.set(member, meta);
  }
  return map;
}

/** Human display name for a star: proper name → Bayer → Flamsteed → HIP. */
export function starDisplayName(s: {
  name?: string;
  bayer?: string;
  flam?: string;
  constellation?: string;
  hip: number;
}): string {
  return (
    s.name ||
    (s.bayer && s.constellation ? `${s.bayer} ${s.constellation}` : null) ||
    (s.flam && s.constellation ? `${s.flam} ${s.constellation}` : null) ||
    `HIP ${s.hip}`
  );
}

/**
 * Nearest star with a proper name / Bayer / Flamsteed designation within `maxDeg` of
 * the given sky position, or undefined if none. Used for display-only naming of
 * custom-location frames — it never affects frame anchoring (which stays DSO-only).
 */
export function nearestNamedStar(ra: number, dec: number, maxDeg = 3): Star | undefined {
  const toRad = Math.PI / 180;
  const d1 = dec * toRad;
  const sinD1 = Math.sin(d1);
  const cosD1 = Math.cos(d1);
  let best: Star | undefined;
  let bestCos = Math.cos(maxDeg * toRad); // accept only stars closer than maxDeg
  for (const s of stars) {
    if (!(s.name || s.bayer || s.flam)) continue;
    const d2 = s.dec * toRad;
    const cos = sinD1 * Math.sin(d2) + cosD1 * Math.cos(d2) * Math.cos((s.ra - ra) * toRad);
    if (cos > bestCos) {
      bestCos = cos;
      best = s;
    }
  }
  return best;
}
