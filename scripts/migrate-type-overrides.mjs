#!/usr/bin/env node
/**
 * migrate-type-overrides.mjs
 *
 * One-shot migration: reads the TYPE_OVERRIDE dict from generate-dso.mjs
 * and writes the corrected DSO type into dso-metadata-overrides.json.
 *
 * Safe to run multiple times — will not overwrite an existing `type` value.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OVERRIDES_PATH = join(__dirname, 'dso-metadata-overrides.json');

// Copy of TYPE_OVERRIDE from generate-dso.mjs
const TYPE_OVERRIDE = {
  // Well-known Messier objects that may be generic 'Neb' in OpenNGC
  M8: 'EN', // Lagoon Nebula
  M16: 'EN', // Eagle Nebula
  M17: 'EN', // Omega Nebula
  M20: 'EN', // Trifid Nebula
  M24: 'OC', // Sagittarius Star Cloud
  M42: 'EN', // Orion Nebula
  M43: 'EN', // De Mairan's Nebula
  M73: 'OC', // Asterism (treat as open cluster)
  M78: 'RN', // Reflection nebula in Orion
  // Emission nebulae
  IC434: 'EN', // Horsehead Nebula region
  NGC2024: 'EN', // Flame Nebula
  NGC1499: 'EN', // California Nebula
  NGC1977: 'EN', // Running Man Nebula
  NGC2023: 'RN', // Reflection nebula near Horsehead
  NGC2064: 'RN', // Reflection nebula
  NGC1999: 'RN', // Reflection nebula in Orion
  IC2118: 'RN', // Witch Head Nebula (reflection)
  IC405: 'EN', // Flaming Star Nebula
  IC410: 'EN', // Emission nebula in Auriga
  IC417: 'EN', // Spider Nebula
  IC1396: 'EN', // Elephant's Trunk Nebula region
  IC1805: 'EN', // Heart Nebula
  IC1848: 'EN', // Soul Nebula
  IC2177: 'EN', // Seagull Nebula
  IC4703: 'EN', // Part of Eagle Nebula
  IC5067: 'EN', // Part of Pelican Nebula
  IC5070: 'EN', // Pelican Nebula
  IC5146: 'EN', // Cocoon Nebula
  NGC281: 'EN', // Pacman Nebula
  NGC896: 'EN', // Part of Heart Nebula
  NGC1333: 'RN', // Perseus reflection nebula
  NGC1788: 'RN', // Reflection nebula in Orion
  NGC1975: 'EN', // Emission nebula near M42
  NGC1980: 'EN', // Emission nebula near M42
  NGC1982: 'EN', // M43, part of Orion Nebula
  NGC2068: 'RN', // M78, reflection nebula
  NGC2067: 'RN', // Reflection nebula
  NGC2261: 'RN', // Hubble's Variable Nebula
  NGC6514: 'EN', // M20, Trifid Nebula
  NGC6523: 'EN', // M8, Lagoon Nebula
  NGC6611: 'EN', // M16, Eagle Nebula
  NGC6618: 'EN', // M17, Omega Nebula
  NGC6729: 'RN', // R Coronae Australis Nebula
  NGC6738: 'EN', // Emission nebula
  NGC6960: 'SNR', // Western Veil Nebula (Cygnus Loop)
  NGC6974: 'SNR', // Part of Cygnus Loop
  NGC6979: 'SNR', // Pickering's Triangle
  NGC6992: 'SNR', // Eastern Veil Nebula
  NGC6995: 'SNR', // Part of eastern Veil
  NGC7000: 'EN', // North America Nebula
  NGC7023: 'RN', // Iris Nebula
  NGC7129: 'RN', // Reflection nebula cluster
  NGC7380: 'EN', // Wizard Nebula
  NGC7635: 'EN', // Bubble Nebula
  NGC7822: 'EN', // Emission nebula in Cepheus
  IC2067: 'RN', // Reflection nebula
};

const overrides = JSON.parse(readFileSync(OVERRIDES_PATH, 'utf8'));

// Build a reverse-lookup: normalised id → entry index
// (covers both entry.id and every catalog alias)
const idxByNormId = new Map();
for (let i = 0; i < overrides.length; i++) {
  const e = overrides[i];
  idxByNormId.set(String(e.id).toUpperCase(), i);
  if (Array.isArray(e.catalogs)) {
    for (const cat of e.catalogs) {
      idxByNormId.set(String(cat).toUpperCase(), i);
    }
  }
}

// Track which override-file entries have already been assigned a type in this
// run, so that two TYPE_OVERRIDE keys pointing at the same entry (e.g. 'M8'
// and 'NGC6523') are only applied once.
const applied = new Set();

let updated = 0;
let added = 0;

for (const [rawId, type] of Object.entries(TYPE_OVERRIDE)) {
  const norm = rawId.toUpperCase();
  const idx = idxByNormId.get(norm);

  if (idx !== undefined) {
    if (applied.has(idx)) continue; // already handled via another alias
    applied.add(idx);
    if (!overrides[idx].type) {
      overrides[idx].type = type;
      updated++;
    }
  } else {
    // No existing entry — add a minimal one so the type is recorded
    const newEntry = { id: rawId, type, catalogs: [rawId] };
    overrides.push(newEntry);
    idxByNormId.set(norm, overrides.length - 1);
    added++;
    console.log(`  New entry for ${rawId} (${type})`);
  }
}

writeFileSync(OVERRIDES_PATH, JSON.stringify(overrides, null, 2) + '\n', 'utf8');
console.log(`Done. Set type on ${updated} existing entries, created ${added} new entries.`);
console.log(`Total entries: ${overrides.length}`);
