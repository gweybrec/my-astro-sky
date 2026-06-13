#!/usr/bin/env node
/**
 * generate-constellation-styles.mjs
 * Generates constellation line data files for alternative sky culture styles.
 *
 * Sources: Stellarium sky cultures on GitHub (GPL-licensed sky culture data)
 * Output: public/data/constellations.lines.{style}.json (same GeoJSON MultiLineString
 *         format as constellations.lines.json, coordinates as [ra_deg, dec_deg])
 *
 * Usage: node scripts/generate-constellation-styles.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STARS_PATH = join(__dirname, '../public/data/stars.14.json');
const OUT_DIR = join(__dirname, '../public/data');

const STELLARIUM_BASE =
  'https://raw.githubusercontent.com/Stellarium/stellarium/master/skycultures';

const STYLES = [
  { key: 'stellarium', culture: 'modern' },
  { key: 'rey',        culture: 'modern_rey' },
  { key: 'chinese',    culture: 'chinese' },
  { key: 'arabic',     culture: 'arabic_al-sufi' },
];

// ─── Build HIP → {ra, dec} map from stars.14.json ───────────────────────────
function buildHipMap() {
  console.log('Loading star catalog...');
  const data = JSON.parse(readFileSync(STARS_PATH, 'utf8'));
  const map = new Map();
  for (const f of data.features) {
    const [ra, dec] = f.geometry.coordinates;
    map.set(f.id, { ra, dec });
  }
  console.log(`  Loaded ${map.size} stars.`);
  return map;
}

// ─── Fetch JSON from URL ─────────────────────────────────────────────────────
async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

// ─── Convert one sky culture's index.json to GeoJSON ────────────────────────
//
// index.json has: constellations[].{ id, lines[] }
//   id: e.g. "CON modern Aql" — last token is the constellation identifier
//   lines: array of polylines, each polyline is an array of HIP IDs (connected)
//
// We map each polyline's HIP IDs to [ra, dec] pairs.
// Polylines where any star is missing from our catalog are skipped.
//
function convertCulture(indexData, hipMap, styleName) {
  const features = [];
  let missingHips = 0;
  let totalPolylines = 0;
  let skippedPolylines = 0;

  for (const con of indexData.constellations ?? []) {
    // Extract the constellation identifier from the id string
    const idParts = (con.id ?? '').split(/\s+/);
    const conId = idParts[idParts.length - 1] || con.id;

    const segments = [];

    for (const polyline of con.lines ?? []) {
      totalPolylines++;
      const points = [];
      let skip = false;

      for (const hip of polyline) {
        const star = hipMap.get(hip);
        if (!star) {
          missingHips++;
          skip = true;
          break;
        }
        points.push([star.ra, star.dec]);
      }

      if (skip || points.length < 2) {
        skippedPolylines++;
        continue;
      }
      segments.push(points);
    }

    if (segments.length === 0) continue;

    features.push({
      type: 'Feature',
      id: conId,
      properties: { rank: '1' },
      geometry: {
        type: 'MultiLineString',
        coordinates: segments,
      },
    });
  }

  console.log(
    `  [${styleName}] ${features.length} constellations, ` +
    `${totalPolylines - skippedPolylines}/${totalPolylines} polylines, ` +
    `${missingHips} missing HIP lookups`
  );

  return { type: 'FeatureCollection', features };
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const hipMap = buildHipMap();

  for (const { key, culture } of STYLES) {
    const url = `${STELLARIUM_BASE}/${culture}/index.json`;
    console.log(`\nFetching ${key} (${culture}) from ${url}...`);

    let indexData;
    try {
      indexData = await fetchJSON(url);
    } catch (e) {
      console.error(`  ERROR: ${e.message} — skipping ${key}`);
      continue;
    }

    const geoJSON = convertCulture(indexData, hipMap, key);
    const outPath = join(OUT_DIR, `constellations.lines.${key}.json`);
    writeFileSync(outPath, JSON.stringify(geoJSON));
    console.log(`  Written → ${outPath}`);
  }

  console.log('\nDone.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
