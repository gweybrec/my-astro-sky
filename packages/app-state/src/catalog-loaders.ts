/**
 * The start-up loaders of the deep-sky and star registries, shared by the desktop (`src/dso-catalog.ts`,
 * `src/star-catalog.ts`, which pass their own language and data functions) and the phone. They fetch the bundled
 * files and call the core registries' setters.
 */
import type {
  ConstellationInfo,
  ConstellationStyle,
  DSOUserOverride,
  Star,
} from '@myastrosky/core/types';
import { normalizeRA } from '@myastrosky/core/angles';
import { logInfo } from '@myastrosky/core/platform/log';
import { setDsoCatalog } from '@myastrosky/core/catalog/dso-registry';
import { forEachStar } from '@myastrosky/core/catalog/star-lists';
import {
  expandMultiples,
  hasConstellationLines,
  parseConstellationLines,
  setConstellationInfos,
  setConstellationLines,
  setStarCatalog,
} from '@myastrosky/core/catalog/star-registry';

export interface DsoLoaderOptions {
  /** The language the display names are resolved for. */
  lang: string;
  /** The user's overrides; a failure is ignored (the catalogue loads without them). */
  getOverrides: () => Promise<Record<string, DSOUserOverride>>;
}

/** Loads `/data/dso.json` and the user's overrides into the deep-sky registry. */
export async function loadDsoCatalogData(opts: DsoLoaderOptions): Promise<void> {
  const json = await fetch('/data/dso.json').then((r) => r.json());
  let overrides: Record<string, DSOUserOverride> = {};
  try {
    overrides = await opts.getOverrides();
  } catch {
    // Silently ignore if user overrides can't be loaded
  }
  setDsoCatalog(json, overrides, opts.lang);
}

export interface StarLoaderOptions {
  lang: string;
  /** The address of the star catalogue file to load (the backend decides). */
  starCatalogUrl: () => Promise<string>;
  /** The message of a file that could not be fetched. */
  loadError: (url: string, status: number, statusText: string) => string;
}

async function fetchJSON(url: string, opts: StarLoaderOptions): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(opts.loadError(url, res.status, res.statusText));
  return res.json();
}

async function fetchCatalog(opts: StarLoaderOptions): Promise<any> {
  try {
    const url = await opts.starCatalogUrl();
    const data = await fetchJSON(url, opts);
    logInfo('Catalog', `Loaded star catalog from ${url}`);
    return data;
  } catch {
    // Fallback if the backend's configuration is unavailable
    console.warn('[Catalog] Could not fetch config, falling back to stars.14.json');
    return fetchJSON('/data/stars.14.json', opts);
  }
}

/** Loads the stars, the western constellation lines, the star names, the constellations and the multiple systems. */
export async function loadStarCatalogData(opts: StarLoaderOptions): Promise<void> {
  const [starsData, linesData, namesData, constData, multiplesData] = await Promise.all([
    fetchCatalog(opts),
    fetchJSON('/data/constellations.lines.json', opts),
    fetchJSON('/data/starnames.json', opts),
    fetchJSON('/data/constellations.json', opts),
    fetchJSON('/data/star-multiples.json', opts),
  ]);

  // Expand the curated systems: the metadata attaches to the primary HIP *and* every
  // listed companion HIP (e.g. Albireo β1 + β2 Cyg), so each present component shows it.
  const multByHip = expandMultiples(multiplesData);

  const stars: Star[] = [];
  forEachStar(starsData, (hip, ra, dec, mag, bv) => {
    const info = namesData[String(hip)];
    stars.push({
      hip,
      ra: normalizeRA(ra),
      dec,
      mag,
      bv,
      name: info?.name || undefined,
      bayer: info?.bayer || undefined,
      flam: info?.flam || undefined,
      constellation: info?.c || undefined,
      desig: info?.desig || undefined,
      multiplicity: multByHip.get(hip),
    });
  });

  // Raw systems are retained for the Targets recommender.
  setStarCatalog(stars, multiplesData);

  // Parse and cache the default (western) constellation lines
  setConstellationLines('western', parseConstellationLines(linesData));

  const infos: ConstellationInfo[] = [];
  for (const f of constData.features) {
    const p = f.properties;
    let displayName: string;
    if (opts.lang === 'fr') displayName = p.fr || p.name;
    else if (opts.lang === 'es') displayName = p.es || p.en || p.name;
    else if (opts.lang === 'de') displayName = p.de || p.name;
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

/** Loads the lines of one constellation style (once; later calls find them cached). */
export async function loadConstellationStyleData(
  style: ConstellationStyle,
  opts: StarLoaderOptions,
): Promise<void> {
  if (hasConstellationLines(style)) return;
  const data = await fetchJSON(`/data/constellations.lines.${style}.json`, opts);
  setConstellationLines(style, parseConstellationLines(data));
}
