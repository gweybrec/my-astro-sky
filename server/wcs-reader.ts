import fs from 'fs';
import { normalizeRA } from '@myastrosky/core/angles';
import { wcsToCorrespondencesWithCatalog } from '@myastrosky/core/wcs';
import type { CatalogStar, Correspondence, WCSData } from '@myastrosky/core/wcs';
import path from 'path';
import { fileURLToPath } from 'url';

// The pure FITS/TIFF header + WCS logic lives in core; re-exported so server code and tests keep
// importing it from here.
export * from '@myastrosky/core/wcs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Server-side star catalog (loaded lazily)
let serverStars: CatalogStar[] | null = null;

export function loadServerCatalog(): CatalogStar[] {
  if (serverStars) return serverStars;

  // Check environment variable first, then fall back to the shipped catalog
  const publicDataDir = process.env.PUBLIC_DATA_DIR || path.join(__dirname, '..', 'public', 'data');
  const catalogPaths = [
    process.env.STAR_CATALOG_PATH,
    path.join(publicDataDir, 'stars.14.json'),
  ].filter(Boolean) as string[];

  let starsPath: string | null = null;
  let usedPath = '';

  for (const p of catalogPaths) {
    if (fs.existsSync(p)) {
      starsPath = p;
      usedPath = p;
      break;
    }
  }

  if (!starsPath) {
    console.error('[Catalog] No star catalog found. Tried:', catalogPaths);
    console.error('[Catalog] Run: bash scripts/download-catalog.sh 14');
    throw new Error('Star catalog not found');
  }

  const namesPath = path.join(
    process.env.PUBLIC_DATA_DIR || path.join(__dirname, '..', 'public', 'data'),
    'starnames.json',
  );

  const starsData = JSON.parse(fs.readFileSync(starsPath, 'utf-8'));
  const namesData = fs.existsSync(namesPath) ? JSON.parse(fs.readFileSync(namesPath, 'utf-8')) : {};

  serverStars = [];
  for (const f of starsData.features) {
    const hip: number = f.id;
    const [ra, dec]: [number, number] = f.geometry.coordinates;
    const info = namesData[String(hip)];
    serverStars.push({
      hip,
      ra: normalizeRA(ra),
      dec,
      mag: f.properties.mag,
      name: info?.name || undefined,
      bayer: info?.bayer || undefined,
      constellation: info?.c || undefined,
    });
  }

  serverStars.sort((a, b) => a.mag - b.mag);

  const catalogName = path.basename(usedPath);
  const maxMag = Math.max(...serverStars.map((s) => s.mag));
  console.log(
    `[Catalog] Loaded ${serverStars.length} stars from ${catalogName} (mag ≤ ${maxMag.toFixed(1)})`,
  );

  return serverStars;
}

export function wcsToCorrespondences(
  wcs: WCSData,
  imageWidth: number,
  imageHeight: number,
  fitsYConvention = false,
): Correspondence[] {
  return wcsToCorrespondencesWithCatalog(
    wcs,
    loadServerCatalog(),
    imageWidth,
    imageHeight,
    fitsYConvention,
  );
}
