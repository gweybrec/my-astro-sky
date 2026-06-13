#!/usr/bin/env node
/**
 * add-galaxy-types.mjs
 * Replaces the generic 'Gx' type in dso.json with more specific subtypes:
 *   GxS — Spiral galaxy (Sa–Sd, SBa–SBd, SAB, S0 with arms, Magellanic spirals)
 *   GxE — Elliptical / Lenticular galaxy (E0–E7, cD, S0)
 *   GxI — Irregular galaxy (Irr, Im, BCD, dIrr, Sm)
 *   Gx  — Galaxy, unclassified (no Hubble type in OpenNGC)
 *
 * Source: OpenNGC CSV, "Hubble" column.
 */

import fs from 'fs';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DSO_JSON_PATH = path.join(__dirname, '..', 'public/data/dso.json');
const OPENGC_URL = 'https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/NGC.csv';

// ─── Hubble type → galaxy subtype ────────────────────────────────────────────

function classifyHubble(hubble) {
  if (!hubble) return 'Gx';
  const h = hubble.trim();
  if (!h) return 'Gx';

  // Elliptical: E, E0–E7, cD (supergiant elliptical), lE, E-S0 (transitional), E?
  if (/^E[0-9]?(-[0-9])?$/.test(h) || h === 'cD' || h === 'lE') return 'GxE';
  if (h === 'E?' || h === 'E-S0' || h.startsWith('E-S')) return 'GxE';

  // Lenticular: S0 and SB0 variants (disk but no spiral arms → grouped with elliptical)
  if (/^S[AB]?0/.test(h)) return 'GxE';

  // Irregular: Irr*, Im (Magellanic irregular), I (irregular), IB (irregular barred),
  //            IAB (irregular with bar), BCD (blue compact dwarf), dIrr, I0
  if (/^Irr|^Im$|^BCD$|^dIrr|^I0|^IB$|^IAB$|^IA$|^I$/.test(h)) return 'GxI';
  // Sm / SBm / SABm (Magellanic Cloud type) → irregular
  if (/^Sm$|^SBm$|^SABm$/.test(h)) return 'GxI';

  // Spiral: S, SB, SAB — any variant (Sa, Sb, Sc, Sd, SBa, SBb, SABc, etc.)
  if (/^S[AB]?[abcde]|^SAB[abcde]?|^S[AB]$/.test(h)) return 'GxS';

  return 'Gx'; // peculiar (S?), unclassified, or truly unknown
}

// ─── Fetch OpenNGC CSV ────────────────────────────────────────────────────────

function fetchCSV(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Fetching OpenNGC CSV for Hubble types...');
  const csv = await fetchCSV(OPENGC_URL);
  const lines = csv.split('\n');
  const header = lines[0].split(';');
  const colName    = header.indexOf('Name');
  const colHubble  = header.indexOf('Hubble');
  const colType    = header.indexOf('Type');

  // Build map: "NGC1234" / "IC1234" → galaxy subtype
  const hubbleMap = new Map();
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(';');
    if (parts.length < 3) continue;
    const rawType = parts[colType]?.trim();
    if (rawType !== 'G' && rawType !== 'G?') continue; // only galaxies
    const name   = parts[colName]?.trim();   // e.g. "NGC1234" or "IC0001"
    const hubble = parts[colHubble]?.trim(); // e.g. "Sb", "E3", "Irr"
    if (!name) continue;

    // Normalise to "NGC1234" / "IC1234" (remove leading zeros in number)
    const m = name.match(/^(NGC|IC)0*(\d+)$/i);
    if (!m) continue;
    const key = m[1].toUpperCase() + m[2]; // "NGC5194", "IC0001" → "IC1"
    hubbleMap.set(key, classifyHubble(hubble));
  }
  console.log(`  Mapped ${hubbleMap.size} NGC/IC galaxies`);

  // ─── Patch dso.json ─────────────────────────────────────────────────────────
  const dsoJson = JSON.parse(fs.readFileSync(DSO_JSON_PATH, 'utf8'));
  const fields   = dsoJson.fields;
  const idxType  = fields.indexOf('type');
  const idxCats  = fields.indexOf('catalogs');

  let nPatched = 0, nUnknown = 0;
  const subtypeCounts = { GxS: 0, GxE: 0, GxI: 0, Gx: 0 };

  for (const row of dsoJson.data) {
    if (row[idxType] !== 'Gx') continue;
    const catalogs = row[idxCats] ?? [];
    let subtype = 'Gx';

    for (const cat of catalogs) {
      const m = cat.match(/^(NGC|IC)0*(\d+)$/i);
      if (!m) continue;
      const key = m[1].toUpperCase() + m[2];
      const mapped = hubbleMap.get(key);
      if (mapped) { subtype = mapped; break; }
    }

    row[idxType] = subtype;
    subtypeCounts[subtype]++;
    nPatched++;
    if (subtype === 'Gx') nUnknown++;
  }

  fs.writeFileSync(DSO_JSON_PATH, JSON.stringify(dsoJson));

  console.log(`\n─── Galaxy subtype distribution ───`);
  console.log(`  GxS (Spiral):      ${subtypeCounts.GxS}`);
  console.log(`  GxE (Elliptical):  ${subtypeCounts.GxE}`);
  console.log(`  GxI (Irregular):   ${subtypeCounts.GxI}`);
  console.log(`  Gx  (Unknown):     ${subtypeCounts.Gx}`);
  console.log(`  Total patched:     ${nPatched}`);
  console.log(`\n✓ Patched ${DSO_JSON_PATH}`);
}

main().catch(e => { console.error(e); process.exit(1); });
