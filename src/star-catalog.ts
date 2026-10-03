import type { Star, StarMultiplicity, ConstellationInfo, ConstellationStyle } from './types';
import { getLang, t } from './i18n';
import { normalizeRA } from '@myastrosky/core/angles';
import {
  expandMultiples,
  hasConstellationLines,
  nearestNamedStar,
  parseConstellationLines,
  setConstellationInfos,
  setConstellationLines,
  setStarCatalog,
  starDisplayName,
} from '@myastrosky/core/catalog/star-registry';

export * from '@myastrosky/core/catalog/star-registry';

export { normalizeRA };

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

  // Expand the curated systems: the metadata attaches to the primary HIP *and* every
  // listed companion HIP (e.g. Albireo β1 + β2 Cyg), so each present component shows it.
  const multByHip = expandMultiples(multiplesData);

  // Parse stars
  const stars: Star[] = [];
  for (const f of starsData.features) {
    const hip: number = f.id;
    const [ra, dec]: [number, number] = f.geometry.coordinates;
    const info = namesData[String(hip)];
    stars.push({
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
    });
  }

  // Raw systems are retained for the Targets recommender (see multiple-stars.ts).
  setStarCatalog(stars, multiplesData);

  // Parse and cache the default (western) constellation lines
  setConstellationLines('western', parseConstellationLines(linesData));

  // Parse constellation info
  const lang = getLang();
  const infos: ConstellationInfo[] = [];
  for (const f of constData.features) {
    const p = f.properties;
    let displayName: string;
    if (lang === 'fr') displayName = p.fr || p.name;
    else if (lang === 'es') displayName = p.es || p.en || p.name;
    else if (lang === 'de') displayName = p.de || p.name;
    else displayName = p.en || p.name;
    infos.push({
      id: f.id,
      name: f.properties.name,
      displayName,
      ra: normalizeRA(f.geometry.coordinates[0]),
      dec: f.geometry.coordinates[1],
    });
  }
  setConstellationInfos(infos);
}

export async function loadConstellationStyle(style: ConstellationStyle): Promise<void> {
  if (hasConstellationLines(style)) return; // already cached
  const data = await fetchJSON(`/data/constellations.lines.${style}.json`);
  setConstellationLines(style, parseConstellationLines(data));
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
 * Display label for a custom-location frame (no DSO): the nearest named star, or the
 * generic "custom location" string when none is close. Display-only — the frame's
 * anchor (dsoId) is unaffected.
 */
export function customLocationLabel(ra: number, dec: number): string {
  const s = nearestNamedStar(ra, dec);
  return s ? starDisplayName(s) : t('fovOverlay.customLocation');
}
