import type {
  Star,
  StarMultiplicity,
  ConstellationLine,
  ConstellationInfo,
  ConstellationStyle,
} from './types';
import { getLang, t } from './i18n';

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

export function normalizeRA(ra: number): number {
  while (ra < 0) ra += 360;
  while (ra >= 360) ra -= 360;
  return ra;
}

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

async function fetchJSON(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      t('errors.catalogLoad', { url, status: res.status, statusText: res.statusText }),
    );
  }
  return res.json();
}

async function fetchCatalog(): Promise<any> {
  // Ask the server which catalog to use (driven by STAR_CATALOG_PATH in .env)
  try {
    const config = await fetchJSON('/api/config');
    const url = config.starCatalog as string;
    const data = await fetchJSON(url);
    console.log(`[Catalog] Loaded star catalog from ${url}`);
    return data;
  } catch (err) {
    // Fallback if server config unavailable
    console.warn('[Catalog] Could not fetch config, falling back to stars.14.json');
    return fetchJSON('/data/stars.14.json');
  }
}

export async function loadCatalog(): Promise<void> {
  const [starsData, linesData, namesData, constData, multiplesData] = await Promise.all([
    fetchCatalog(),
    fetchJSON('/data/constellations.lines.json'),
    fetchJSON('/data/starnames.json'),
    fetchJSON('/data/constellations.json'),
    fetchJSON('/data/star-multiples.json'),
  ]);

  // Retain the raw systems for the Targets recommender (see multiple-stars.ts).
  multipleSystems = multiplesData;
  // Expand the curated systems: the metadata attaches to the primary HIP *and* every
  // listed companion HIP (e.g. Albireo β1 + β2 Cyg), so each present component shows it.
  const multByHip = expandMultiples(multiplesData);

  // Parse stars
  for (const f of starsData.features) {
    const hip: number = f.id;
    const [ra, dec]: [number, number] = f.geometry.coordinates;
    const info = namesData[String(hip)];
    const star: Star = {
      hip,
      ra: normalizeRA(ra),
      dec,
      mag: f.properties.mag,
      bv: parseFloat(f.properties.bv) || 0,
      name: info?.name || undefined,
      bayer: info?.bayer || undefined,
      flam: info?.flam || undefined,
      constellation: info?.c || undefined,
      desig: info?.desig || undefined,
      multiplicity: multByHip.get(hip),
    };
    stars.push(star);
    starsByHip.set(hip, star);
  }

  // Sort by magnitude (brightest first) for rendering priority
  stars.sort((a, b) => a.mag - b.mag);
  starMagsSorted = null; // invalidate cache; rebuilt lazily on next access

  // Parse and cache the default (western) constellation lines
  constellationLinesByStyle.set('western', parseConstellationLines(linesData));

  // Parse constellation info
  const lang = getLang();
  for (const f of constData.features) {
    const p = f.properties;
    let displayName: string;
    if (lang === 'fr') displayName = p.fr || p.name;
    else if (lang === 'es') displayName = p.es || p.en || p.name;
    else if (lang === 'de') displayName = p.de || p.name;
    else displayName = p.en || p.name;
    constellationInfos.push({
      id: f.id,
      name: f.properties.name,
      displayName,
      ra: normalizeRA(f.geometry.coordinates[0]),
      dec: f.geometry.coordinates[1],
    });
  }
}

export async function loadConstellationStyle(style: ConstellationStyle): Promise<void> {
  if (constellationLinesByStyle.has(style)) return; // already cached
  const data = await fetchJSON(`/data/constellations.lines.${style}.json`);
  constellationLinesByStyle.set(style, parseConstellationLines(data));
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

export function getConstellationInfos(): ConstellationInfo[] {
  return constellationInfos;
}

export function getNamedStars(): Star[] {
  return stars.filter((s) => s.name || s.bayer);
}

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

/** i18n key for a system's type name, by star count (2 = binary … 8 = octuple). */
const MULTIPLE_KEY_BY_COUNT: Record<number, string> = {
  2: 'stars.multiple.binary',
  3: 'stars.multiple.triple',
  4: 'stars.multiple.quadruple',
  5: 'stars.multiple.quintuple',
  6: 'stars.multiple.sextuple',
  7: 'stars.multiple.septuple',
  8: 'stars.multiple.octuple',
};

/** Localised display string for a star's multiplicity, e.g. "Binary · 34.3″". */
export function formatMultiplicity(m: StarMultiplicity): string {
  const key = MULTIPLE_KEY_BY_COUNT[m.components];
  const typeName = key ? t(key) : t('stars.multiple.system', { n: m.components });
  return m.sep ? `${typeName} · ${m.sep}″` : typeName;
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

/**
 * Display label for a custom-location frame (no DSO): the nearest named star, or the
 * generic "custom location" string when none is close. Display-only — the frame's
 * anchor (dsoId) is unaffected.
 */
export function customLocationLabel(ra: number, dec: number): string {
  const s = nearestNamedStar(ra, dec);
  return s ? starDisplayName(s) : t('fovOverlay.customLocation');
}
