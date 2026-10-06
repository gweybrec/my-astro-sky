import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildDeepStars } from '@myastrosky/core/catalog/star-lists';
import type { DeepStar } from '@myastrosky/core/domain/stars';

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
  const multiplesData = fs.existsSync(multiplesPath)
    ? JSON.parse(fs.readFileSync(multiplesPath, 'utf-8'))
    : {};

  const stars = buildDeepStars(starsData, namesData, multiplesData);
  console.log(`Catalogue chargé : ${stars.length} étoiles (mag ≤ 11)`);
  deepStars = stars;
  return stars;
}
