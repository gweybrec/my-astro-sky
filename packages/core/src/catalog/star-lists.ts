/**
 * Turns the star catalogue files (already parsed from JSON) into the two lists the services use. The host
 * reads the files: the server from disk, the phone from its bundled data.
 */
import { normalizeRA } from '../angles';
import type { DeepStar } from '../domain/stars';
import type { StarMultiplicity } from '../types';
import type { CatalogStar } from '../wcs';

/** `stars.14.json`: a GeoJSON-like collection, one feature per star (`id` is the HIP number). */
export interface StarsJson {
  features: {
    id: number;
    properties: { mag: number; bv?: string | number };
    geometry: { coordinates: [number, number] };
  }[];
}

/** `starnames.json`: names by HIP number. */
export type StarNamesJson = Record<
  string,
  { name?: string; bayer?: string; flam?: string; c?: string; desig?: string }
>;

/** `star-multiples.json`: curated multiple-star metadata by HIP number; `members` are companions that inherit it. */
export type StarMultiplesJson = Record<string, StarMultiplicity & { members?: number[] }>;

/** The deep catalogue (magnitude 11 and brighter), brightest first, with names and multiplicity. */
export function buildDeepStars(
  starsJson: StarsJson,
  namesJson: StarNamesJson,
  multiplesJson: StarMultiplesJson = {},
): DeepStar[] {
  const multByHip = new Map<number, StarMultiplicity>();
  for (const [hipStr, e] of Object.entries(multiplesJson)) {
    const meta: StarMultiplicity = { components: e.components };
    if (e.sep) meta.sep = e.sep;
    multByHip.set(Number(hipStr), meta);
    for (const member of e.members ?? []) multByHip.set(member, meta);
  }

  const stars: DeepStar[] = [];
  for (const f of starsJson.features) {
    const mag: number = f.properties.mag;
    if (mag > 11) continue;

    const hip: number = f.id;
    const [ra, dec] = f.geometry.coordinates;
    const info = namesJson[String(hip)];

    stars.push({
      hip,
      ra: normalizeRA(ra),
      dec,
      mag,
      bv: parseFloat(String(f.properties.bv)) || 0,
      name: info?.name || undefined,
      bayer: info?.bayer || undefined,
      flam: info?.flam || undefined,
      constellation: info?.c || undefined,
      desig: info?.desig || undefined,
      multiplicity: multByHip.get(hip),
    });
  }
  stars.sort((a, b) => a.mag - b.mag);
  return stars;
}

/** The catalogue that solved files are matched against (every magnitude), brightest first. */
export function buildCatalogStars(
  starsJson: StarsJson,
  namesJson: StarNamesJson = {},
): CatalogStar[] {
  const stars: CatalogStar[] = [];
  for (const f of starsJson.features) {
    const hip: number = f.id;
    const [ra, dec] = f.geometry.coordinates;
    const info = namesJson[String(hip)];
    stars.push({
      hip,
      ra: normalizeRA(ra),
      dec,
      mag: f.properties.mag,
      name: info?.name || undefined,
      bayer: info?.bayer || undefined,
      constellation: info?.c || undefined,
    });
  }
  stars.sort((a, b) => a.mag - b.mag);
  return stars;
}
