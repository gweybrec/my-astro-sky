import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeRA } from '@myastrosky/core/angles';
import type { DeepStar } from '@myastrosky/core/domain/stars';
import type { StarMultiplicity } from '@myastrosky/core/types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let deepStars: DeepStar[] | null = null;

/**
 * Reads the deep star catalogue from disk on first use (then caches it) and returns it sorted by
 * magnitude. The search itself lives in the star-search service of `@myastrosky/core`.
 */
export function loadDeepCatalog(): DeepStar[] {
  if (deepStars) return deepStars;

  const publicDataDir = process.env.PUBLIC_DATA_DIR || path.join(__dirname, '..', 'public', 'data');
  // The shipped deep catalog (stars.14.json, ~118k stars), shared with WCS matching
  // via STAR_CATALOG_PATH.
  const catalogPath = process.env.STAR_CATALOG_PATH
    ? path.resolve(process.env.STAR_CATALOG_PATH)
    : path.join(publicDataDir, 'stars.14.json');
  const namesPath = path.join(publicDataDir, 'starnames.json');
  const multiplesPath = path.join(publicDataDir, 'star-multiples.json');

  console.log(`Chargement du catalogue profond (${path.basename(catalogPath)})…`);

  const starsData = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
  const namesData = JSON.parse(fs.readFileSync(namesPath, 'utf-8'));
  // Optional curated binary/multiple-star metadata; absent in minimal data dirs.
  // Each entry may list companion HIPs (`members`) that inherit the same metadata, so
  // every present component of a system (e.g. Albireo β1 + β2 Cyg) surfaces it.
  const multiplesRaw: Record<string, StarMultiplicity & { members?: number[] }> = fs.existsSync(
    multiplesPath,
  )
    ? JSON.parse(fs.readFileSync(multiplesPath, 'utf-8'))
    : {};
  const multByHip = new Map<number, StarMultiplicity>();
  for (const [hipStr, e] of Object.entries(multiplesRaw)) {
    const meta: StarMultiplicity = { components: e.components };
    if (e.sep) meta.sep = e.sep;
    multByHip.set(Number(hipStr), meta);
    for (const member of e.members ?? []) multByHip.set(member, meta);
  }

  const stars: DeepStar[] = [];

  for (const f of starsData.features) {
    const mag: number = f.properties.mag;
    if (mag > 11) continue;

    const hip: number = f.id;
    const [ra, dec]: [number, number] = f.geometry.coordinates;
    const info = namesData[String(hip)];

    stars.push({
      hip,
      ra: normalizeRA(ra),
      dec,
      mag,
      bv: parseFloat(f.properties.bv) || 0,
      name: info?.name || undefined,
      bayer: info?.bayer || undefined,
      flam: info?.flam || undefined,
      constellation: info?.c || undefined,
      desig: info?.desig || undefined,
      multiplicity: multByHip.get(hip),
    });
  }

  stars.sort((a, b) => a.mag - b.mag);
  console.log(`Catalogue chargé : ${stars.length} étoiles (mag ≤ 11)`);
  deepStars = stars;
  return stars;
}
