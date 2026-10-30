#!/usr/bin/env node
/**
 * Rewrites a star catalogue from its GeoJSON form (one feature per star) into the column form the app reads:
 * `{ fields: ['hip','ra','dec','mag','bv'], columns: [[…], …] }`, brightest first (ties keep their order).
 * The values are kept as they are; only `bv`, a string in the GeoJSON, becomes a number (null if unknown).
 *
 *   node scripts/stars-to-columns.mjs [in.json] [out.json]
 *
 * Both default to public/data/stars.14.json. A file already in column form is left as it is.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT = join(dirname(fileURLToPath(import.meta.url)), '../public/data/stars.14.json');
const [input = DEFAULT, output = input] = process.argv.slice(2);

const data = JSON.parse(readFileSync(input, 'utf8'));
if (data.columns) {
  console.log(`${input} is already in column form.`);
  process.exit(0);
}

const rows = data.features.map((f) => {
  const bv = parseFloat(String(f.properties.bv));
  return [
    f.id,
    f.geometry.coordinates[0],
    f.geometry.coordinates[1],
    f.properties.mag,
    Number.isFinite(bv) ? bv : null,
  ];
});
rows.sort((a, b) => a[3] - b[3]);

const columns = [0, 1, 2, 3, 4].map((k) => rows.map((r) => r[k]));
const json = JSON.stringify({ fields: ['hip', 'ra', 'dec', 'mag', 'bv'], columns });
writeFileSync(output, json);
console.log(`${rows.length} stars → ${output} (${(json.length / 1e6).toFixed(1)} MB)`);
