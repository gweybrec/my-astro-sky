import type { Star, ConstellationLine, ConstellationInfo, ConstellationStyle } from './types';
import { getLang, t } from './i18n';

let stars: Star[] = [];
let starsByHip = new Map<number, Star>();
let constellationInfos: ConstellationInfo[] = [];
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
        seg.map(([ra, dec]: number[]) => [normalizeRA(ra), dec] as [number, number])
      ),
    });
  }
  return result;
}

async function fetchJSON(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(t('errors.catalogLoad', { url, status: res.status, statusText: res.statusText }));
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
  const [starsData, linesData, namesData, constData] = await Promise.all([
    fetchCatalog(),
    fetchJSON('/data/constellations.lines.json'),
    fetchJSON('/data/starnames.json'),
    fetchJSON('/data/constellations.json'),
  ]);

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
  if (!starMagsSorted) starMagsSorted = stars.map(s => s.mag);
  return starMagsSorted;
}

export function getConstellationLines(style: ConstellationStyle = 'western'): ConstellationLine[] {
  return constellationLinesByStyle.get(style) ?? [];
}

export function getConstellationInfos(): ConstellationInfo[] {
  return constellationInfos;
}

export function getNamedStars(): Star[] {
  return stars.filter(s => s.name || s.bayer);
}
