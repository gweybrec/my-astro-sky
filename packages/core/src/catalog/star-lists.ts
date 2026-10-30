/**
 * Turns the star catalogue files (already parsed from JSON) into the two lists the services use. The host
 * reads the files: the server from disk, the phone from its bundled data.
 */
import { normalizeRA } from '../angles';
import type { DeepStar } from '../domain/stars';
import type { StarMultiplicity } from '../types';
import type { CatalogStar } from '../wcs';

/** A star catalogue in the GeoJSON form, one feature per star (`id` is the HIP number). Still read: a catalogue set by `STAR_CATALOG_PATH` may be one. */
export interface StarsGeoJson {
  features: {
    id: number;
    properties: { mag: number; bv?: string | number };
    geometry: { coordinates: [number, number] };
  }[];
}

/**
 * `stars.14.json`: one array per field, brightest first (`scripts/stars-to-columns.mjs`). Columns rather than an
 * object per star: the GeoJSON form was 15 MB and took ~200 ms to parse and ~26 MB of memory once parsed on a phone.
 */
export interface StarsColumnsJson {
  fields: ['hip', 'ra', 'dec', 'mag', 'bv'];
  /** In the order of `fields`; `bv` is null where the colour index is unknown. */
  columns: [number[], number[], number[], number[], (number | null)[]];
}

/** A star catalogue file, in either form. */
export type StarsJson = StarsGeoJson | StarsColumnsJson;

/**
 * Calls `fn` for every star of `json`, in file order, without making an object per star. `bv` is 0 where the
 * colour index is unknown.
 */
export function forEachStar(
  json: StarsJson,
  fn: (hip: number, ra: number, dec: number, mag: number, bv: number) => void,
): void {
  if ('columns' in json) {
    const [hip, ra, dec, mag, bv] = json.columns;
    for (let i = 0; i < hip.length; i++) fn(hip[i], ra[i], dec[i], mag[i], bv[i] ?? 0);
    return;
  }
  for (const f of json.features) {
    const [ra, dec] = f.geometry.coordinates;
    fn(f.id, ra, dec, f.properties.mag, parseFloat(String(f.properties.bv)) || 0);
  }
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
  forEachStar(starsJson, (hip, ra, dec, mag, bv) => {
    if (mag > 11) return;
    const info = namesJson[String(hip)];
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
  stars.sort((a, b) => a.mag - b.mag);
  return stars;
}

/** The catalogue that solved files are matched against (every magnitude), brightest first. */
export function buildCatalogStars(
  starsJson: StarsJson,
  namesJson: StarNamesJson = {},
): CatalogStar[] {
  const stars: CatalogStar[] = [];
  forEachStar(starsJson, (hip, ra, dec, mag) => {
    const info = namesJson[String(hip)];
    stars.push({
      hip,
      ra: normalizeRA(ra),
      dec,
      mag,
      name: info?.name || undefined,
      bayer: info?.bayer || undefined,
      constellation: info?.c || undefined,
    });
  });
  stars.sort((a, b) => a.mag - b.mag);
  return stars;
}
