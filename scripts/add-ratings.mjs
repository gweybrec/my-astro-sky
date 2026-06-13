#!/usr/bin/env node
/**
 * add-ratings.mjs
 * Adds 'rating' (1–5 photographic interest) and 'difficulty' (1–5 imaging effort)
 * to every DSO in public/data/dso.json.
 *
 * Sources:
 *   A. scripts/data-750-best-dsos.json  — imaging score from "The 750 Best DSOs" PDF (weight 3)
 *   B. Astrogenerator SQLite DB          — interet field 1–4 mapped to 1–5 score (weight 2)
 *   C. OpenNGC CSV                       — SurfBr for galaxy difficulty (gold standard)
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DSO_JSON_PATH = path.join(__dirname, '..', 'public/data/dso.json');
const PDF_DATA_PATH = path.join(__dirname, 'data-750-best-dsos.json');
const ASTRO_DB_PATH = '/home/gweybrec/workspace/other/astrogenerator/dbastrogenerator';
const OPENGC_URL = 'https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/NGC.csv';

// ─── Catalog membership sets ──────────────────────────────────────────────────

// Messier objects excluded from the Messier floor (not genuine deep-sky targets)
const MESSIER_FLOOR_EXCLUSIONS = new Set(['M40', 'M73']);

// RASC Finest NGC — 110 objects, floor 4
const RASC_FINEST_NGC = new Set([
  'NGC40',   'NGC185',  'NGC246',  'NGC253',  'NGC281',  'NGC457',  'NGC663',  'NGC772',
  'NGC869',  'NGC884',  'NGC891',  'NGC936',  'NGC1023', 'NGC1232', 'NGC1491', 'NGC1501',
  'NGC1514', 'NGC1535', 'NGC1788', 'NGC1931', 'NGC1973', 'NGC1975', 'NGC1977',
  'NGC2022', 'NGC2024', 'NGC2194', 'NGC2237', 'NGC2261', 'NGC2359', 'NGC2371',
  'NGC2372', 'NGC2392', 'NGC2403', 'NGC2440', 'NGC2539', 'NGC2655', 'NGC2683',
  'NGC2841', 'NGC2903', 'NGC3003', 'NGC3079', 'NGC3115', 'NGC3184', 'NGC3242',
  'NGC3344', 'NGC3384', 'NGC3432', 'NGC3521', 'NGC3607', 'NGC3628', 'NGC3877',
  'NGC3941', 'NGC4026', 'NGC4038', 'NGC4039', 'NGC4088', 'NGC4111', 'NGC4157',
  'NGC4214', 'NGC4216', 'NGC4244', 'NGC4274', 'NGC4361', 'NGC4388', 'NGC4414',
  'NGC4435', 'NGC4438', 'NGC4449', 'NGC4490', 'NGC4494', 'NGC4517', 'NGC4526',
  'NGC4535', 'NGC4559', 'NGC4565', 'NGC4567', 'NGC4568', 'NGC4605', 'NGC4631',
  'NGC4656', 'NGC4699', 'NGC4725', 'NGC4762', 'NGC5005', 'NGC5033', 'NGC5466',
  'NGC5746', 'NGC5907', 'NGC6210', 'NGC6369', 'NGC6445', 'NGC6503', 'NGC6520',
  'NGC6543', 'NGC6572', 'NGC6633', 'NGC6712', 'NGC6781', 'NGC6802', 'NGC6818',
  'NGC6819', 'NGC6826', 'NGC6888', 'NGC6939', 'NGC6940', 'NGC6946', 'NGC6960',
  'NGC6992', 'NGC7000', 'NGC7009', 'NGC7027', 'NGC7129', 'NGC7293', 'NGC7331',
  'NGC7635', 'NGC7662', 'NGC7789', 'IC289',
]);

// Caldwell catalogue — NGC/IC objects only, floor 4
const CALDWELL = new Set([
  'NGC40',   'NGC147',  'NGC185',  'NGC188',  'NGC246',  'NGC247',  'NGC253',  'NGC300',
  'NGC362',  'NGC457',  'NGC559',  'NGC663',  'NGC752',  'NGC869',  'NGC884',  'NGC891',
  'NGC1097', 'NGC1261', 'NGC1275', 'NGC2244', 'NGC2261', 'NGC2360', 'NGC2362', 'NGC2392',
  'NGC2403', 'NGC2419', 'NGC2477', 'NGC2506', 'NGC2516', 'NGC2775', 'NGC2867', 'NGC3115',
  'NGC3132', 'NGC3195', 'NGC3201', 'NGC3242', 'NGC3372', 'NGC3532', 'NGC3626', 'NGC3766',
  'NGC4236', 'NGC4244', 'NGC4559', 'NGC4565', 'NGC4631', 'NGC4697', 'NGC4755', 'NGC4833',
  'NGC4889', 'NGC4945', 'NGC5005', 'NGC5128', 'NGC5139', 'NGC5248', 'NGC5286', 'NGC5694',
  'NGC5823', 'NGC6025', 'NGC6087', 'NGC6124', 'NGC6193', 'NGC6229', 'NGC6231', 'NGC6302',
  'NGC6352', 'NGC6397', 'NGC6541', 'NGC6543', 'NGC6633', 'NGC6712', 'NGC6729', 'NGC6744',
  'NGC6752', 'NGC6822', 'NGC6885', 'NGC6888', 'NGC6934', 'NGC6946', 'NGC7006', 'NGC7009',
  'NGC7023', 'NGC7243', 'NGC7293', 'NGC7331', 'NGC7479', 'NGC7635', 'NGC7662', 'NGC7789',
  'NGC7814',
  'IC342', 'IC405', 'IC1613', 'IC2391', 'IC2602', 'IC2944', 'IC5146',
]);

// Herschel 400 — floor 3
const HERSCHEL_400 = new Set([
  ...[
    40, 129, 136, 157, 185, 205, 225, 246, 247, 253, 288, 300, 362, 380, 404, 436,
    457, 488, 524, 559, 578, 584, 596, 613, 615, 628, 636, 650, 654, 663, 720, 752,
    772, 779, 869, 884, 891, 908, 936, 1003, 1023, 1027, 1084, 1245, 1342, 1407,
    1444, 1501, 1502, 1513, 1514, 1528, 1535, 1545, 1664, 1788, 1817, 1857, 1907,
    1931, 1964, 2022, 2024, 2126, 2169, 2185, 2194, 2204, 2215, 2244, 2261, 2281,
    2301, 2324, 2359, 2360, 2362, 2371, 2403, 2419, 2420, 2438, 2440, 2479, 2539,
    2549, 2655, 2683, 2742, 2768, 2775, 2782, 2841, 2857, 2903, 2950, 2964, 2974,
    2976, 3003, 3034, 3053, 3077, 3079, 3115, 3147, 3166, 3169, 3184, 3190, 3193,
    3198, 3226, 3227, 3242, 3245, 3277, 3294, 3344, 3377, 3379, 3384, 3412, 3432,
    3489, 3504, 3521, 3547, 3593, 3607, 3610, 3613, 3615, 3628, 3631, 3640, 3675,
    3686, 3726, 3756, 3810, 3877, 3893, 3898, 3941, 3945, 3962, 4026, 4038, 4039,
    4085, 4088, 4111, 4143, 4145, 4151, 4157, 4179, 4203, 4214, 4216, 4245, 4251,
    4258, 4261, 4273, 4274, 4278, 4281, 4346, 4350, 4361, 4365, 4371, 4374, 4379,
    4387, 4388, 4394, 4414, 4419, 4429, 4435, 4438, 4442, 4449, 4450, 4459, 4473,
    4477, 4478, 4490, 4494, 4517, 4526, 4527, 4535, 4540, 4546, 4548, 4550, 4559,
    4564, 4565, 4570, 4594, 4596, 4608, 4621, 4636, 4643, 4654, 4656, 4660, 4664,
    4666, 4689, 4697, 4699, 4710, 4725, 4753, 4754, 4762, 4772, 4900, 4995, 5005,
    5012, 5033, 5055, 5195, 5248, 5322, 5363, 5364, 5466, 5473, 5474, 5557, 5587,
    5631, 5634, 5676, 5701, 5746, 5762, 5775, 5813, 5838, 5850, 5866, 5879, 5907,
    5982, 6118, 6207, 6210, 6217, 6229, 6369, 6384, 6445, 6503, 6520, 6522, 6528,
    6540, 6543, 6567, 6569, 6572, 6633, 6638, 6643, 6645, 6664, 6712, 6716, 6755,
    6760, 6781, 6802, 6818, 6819, 6826, 6830, 6834, 6838, 6882, 6885, 6888, 6905,
    6939, 6940, 6946, 6951, 6960, 6992, 7000, 7006, 7009, 7027, 7062, 7086, 7129,
    7139, 7142, 7177, 7217, 7243, 7293, 7331, 7380, 7448, 7479, 7510, 7606, 7619,
    7626, 7640, 7662, 7686, 7789, 7790,
  ].map(n => 'NGC' + n),
]);

// ─── Network fetch ────────────────────────────────────────────────────────────

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    https.get(url, res => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    }).on('error', reject);
  });
}

function parseOpenNGCSurfBr(csvText) {
  // Returns Map: 'NGC1' → surfBr (number)
  const map = new Map();
  const lines = csvText.split('\n');
  if (lines.length === 0) return map;

  const header = lines[0].split(';');
  const idxName   = header.indexOf('Name');
  const idxSurfBr = header.indexOf('SurfBr');
  if (idxName < 0 || idxSurfBr < 0) return map;

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(';');
    if (parts.length < Math.max(idxName, idxSurfBr) + 1) continue;
    const nameRaw  = parts[idxName].trim();
    const surfBrRaw = parts[idxSurfBr].trim();
    if (!surfBrRaw) continue;
    const surfBr = parseFloat(surfBrRaw);
    if (isNaN(surfBr) || surfBr === 0) continue;

    let key;
    if (nameRaw.startsWith('NGC'))      key = 'NGC' + parseInt(nameRaw.slice(3));
    else if (nameRaw.startsWith('IC'))  key = 'IC'  + parseInt(nameRaw.slice(2));
    else continue;

    map.set(key, surfBr);
  }
  return map;
}

// ─── Astrogenerator helpers ───────────────────────────────────────────────────

/** Map astrogenerator interet (1–4) to 1–5 rating score */
function interetToScore(interet) {
  switch (interet) {
    case 1: return 1; // No interest
    case 2: return 2; // Little interest
    case 3: return 3; // Interesting
    case 4: return 5; // Remarkable → 5 (skip 4 to create spread)
    default: return null;
  }
}

// ─── Rating computation ───────────────────────────────────────────────────────

function computeRating({ catalogs, type, mag, majAxis, nameFr, nameEn, pdf750, agMap }) {
  let sumWeighted = 0;
  let sumWeight = 0;

  // Source A: 750 Best DSOs (weight 3)
  for (const cat of catalogs) {
    if (pdf750[cat] !== undefined) {
      sumWeighted += pdf750[cat] * 3;
      sumWeight += 3;
      break;
    }
  }

  // Source B: astrogenerator interet (weight 2) — NGC/IC only
  for (const cat of catalogs) {
    if (cat.startsWith('NGC') || cat.startsWith('IC')) {
      const ag = agMap.get(cat);
      if (ag) {
        const score = interetToScore(ag.interet);
        if (score !== null) {
          sumWeighted += score * 2;
          sumWeight += 2;
          break;
        }
      }
    }
  }

  if (sumWeight > 0) {
    return Math.max(1, Math.min(5, Math.round(sumWeighted / sumWeight)));
  }

  // ── Heuristic fallback (no source matched) ──
  if (nameFr || nameEn) return 3;

  const sz = majAxis ?? 0;
  if (type === 'EN' || type === 'SNR') {
    if (sz > 120) return 3;
    if (sz >= 30)  return 2;
    return 1;
  }
  if (type === 'RN' || type === 'DN') return 1;

  // Unmatched NGC/IC: magnitude-bucketed
  for (const cat of catalogs) {
    if (cat.startsWith('NGC') || cat.startsWith('IC')) {
      if (!mag || mag === 0) return 2;
      if (mag < 6)  return 5;
      if (mag < 8)  return 4;
      if (mag < 10) return 3;
      if (mag < 12) return 2;
      return 1;
    }
  }

  return 1;
}

function applyRatingFloors(rating, catalogs) {
  let floor = 0;
  for (const cat of catalogs) {
    if (/^M\d+$/.test(cat) && !MESSIER_FLOOR_EXCLUSIONS.has(cat)) floor = Math.max(floor, 4);
    if (RASC_FINEST_NGC.has(cat)) floor = Math.max(floor, 4);
    if (CALDWELL.has(cat))        floor = Math.max(floor, 4);
    if (HERSCHEL_400.has(cat))    floor = Math.max(floor, 3);
  }
  return Math.max(rating, floor);
}

// ─── Difficulty computation ───────────────────────────────────────────────────

function typeDifficultyHeuristic(type, mag, emissionLines) {
  switch (type) {
    case 'OC': return 1;
    case 'GC': return 1;
    case 'PN': return (mag !== null && mag > 12) ? 3 : 2;
    case 'EN': return emissionLines ? 2 : 3;
    case 'RN': return 4;
    case 'SNR': return 4;
    case 'DN': return 5;
    default:   return 3;
  }
}

function computeDifficulty({ catalogs, type, mag, majAxis, emissionLines, surfBrMap, agMap }) {
  const sz = majAxis ?? 0;
  const isMessier = catalogs.some(c => /^M\d+$/.test(c));

  // ── Galaxy: SurfBr is the gold standard ──
  if (type === 'Gx') {
    // Cap difficulty based on total magnitude: a mag-10 galaxy that shows up in
    // 30 min should not be rated harder than 2 regardless of mean surface brightness
    // (which is diluted for large or edge-on galaxies). Formula: ceil((mag-7)/2),
    // so mag≤9→1, mag≤11→2, mag≤13→3, mag≤15→4, mag>15→5.
    const magCap = (mag !== null && mag > 0) ? Math.max(1, Math.ceil((mag - 7) / 2)) : 5;

    for (const cat of catalogs) {
      if (cat.startsWith('NGC') || cat.startsWith('IC')) {
        const sb = surfBrMap.get(cat);
        if (sb !== undefined && sb > 0) {
          let d;
          if (sb <= 21.0) d = 1;
          else if (sb <= 22.5) d = 2;
          else if (sb <= 23.5) d = 3;
          else if (sb <= 24.5) d = 4;
          else d = 5;
          d = Math.min(d, magCap);
          return isMessier ? Math.min(d, 2) : d;
        }
      }
    }
    // Galaxy fallback: astrogenerator difficulte 1–4
    for (const cat of catalogs) {
      if (cat.startsWith('NGC') || cat.startsWith('IC')) {
        const ag = agMap.get(cat);
        if (ag?.difficulte && ag.difficulte > 0) {
          const d = Math.min(Math.min(4, ag.difficulte), magCap);
          return isMessier ? Math.min(d, 2) : d;
        }
      }
    }
    const def = Math.min(3, magCap);
    return isMessier ? Math.min(def, 2) : def;
  }

  // ── Non-galaxy: astrogenerator difficulte + adjustments ──
  let base = null;
  for (const cat of catalogs) {
    if (cat.startsWith('NGC') || cat.startsWith('IC')) {
      const ag = agMap.get(cat);
      if (ag?.difficulte && ag.difficulte > 0) {
        base = ag.difficulte; // 1–4
        break;
      }
    }
  }

  if (base === null) {
    base = typeDifficultyHeuristic(type, mag, emissionLines);
  }

  // Size adjustments
  if (sz > 300) return 5;           // very large → nearly impossible to image as a unit
  if (sz > 120) base = base + 1;    // large → lower surface brightness → harder

  // Type adjustments
  if (type === 'RN' || type === 'DN') base = base + 1;  // extended, low SB
  if (emissionLines)                  base = base - 1;  // narrowband reduces difficulty

  const result = Math.max(1, Math.min(5, base));
  // Messier catalog = beginner-accessible by definition
  return isMessier ? Math.min(result, 2) : result;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Loading data sources...');

  // Load 750 Best DSOs data
  const pdf750 = JSON.parse(fs.readFileSync(PDF_DATA_PATH, 'utf8'));
  console.log(`  Source A (750 Best DSOs): ${Object.keys(pdf750).length} entries`);

  // Load astrogenerator DB and build lookup map
  const agDb = new Database(ASTRO_DB_PATH, { readonly: true });
  const agRows = agDb.prepare('SELECT reference, interet, difficulte FROM ngcic').all();
  agDb.close();

  const agMap = new Map();
  for (const row of agRows) {
    if (row.reference.startsWith('NGC')) {
      agMap.set(row.reference.trim(), { interet: row.interet, difficulte: row.difficulte });
    } else if (row.reference.startsWith('I')) {
      const num = parseInt(row.reference.slice(1).trim());
      if (!isNaN(num)) {
        agMap.set('IC' + num, { interet: row.interet, difficulte: row.difficulte });
      }
    }
  }
  console.log(`  Source B (astrogenerator): ${agMap.size} mapped entries`);

  // Fetch OpenNGC CSV for galaxy surface brightness
  let surfBrMap = new Map();
  try {
    console.log('  Fetching OpenNGC CSV for galaxy SurfBr...');
    const csv = await fetchUrl(OPENGC_URL);
    surfBrMap = parseOpenNGCSurfBr(csv);
    console.log(`  OpenNGC SurfBr: ${surfBrMap.size} entries`);
  } catch (e) {
    console.warn(`  WARNING: Could not fetch OpenNGC CSV (${e.message}). Galaxy difficulty will use fallback.`);
  }

  // Load and validate dso.json
  const dsoJson = JSON.parse(fs.readFileSync(DSO_JSON_PATH, 'utf8'));
  const fields = dsoJson.fields;

  if (fields.includes('rating')) {
    console.error('ERROR: dso.json already has "rating" field. Run without the field or reset dso.json first.');
    process.exit(1);
  }

  const idxId       = fields.indexOf('id');
  const idxType     = fields.indexOf('type');
  const idxMajAxis  = fields.indexOf('majAxis');
  const idxMag      = fields.indexOf('mag');
  const idxNameFr   = fields.indexOf('nameFr');
  const idxNameEn   = fields.indexOf('nameEn');
  const idxCatalogs = fields.indexOf('catalogs');
  const idxEmLines  = fields.indexOf('emissionLines');

  // Append new field names
  dsoJson.fields.push('rating', 'difficulty');

  // Stats
  const ratingDist   = [0, 0, 0, 0, 0, 0];
  const diffDist     = [0, 0, 0, 0, 0, 0];
  let nSourceA = 0, nSourceB = 0, nBoth = 0, nHeuristic = 0;

  // Spot-check log
  const SPOT_CHECKS = new Set(['M42', 'M31', 'M1', 'SH2-240', 'M40', 'M73', 'NGC4565', 'NGC891']);

  for (const row of dsoJson.data) {
    const catalogs      = row[idxCatalogs] ?? [row[idxId]];
    const type          = row[idxType];
    const mag           = row[idxMag];
    const majAxis       = row[idxMajAxis];
    const nameFr        = row[idxNameFr];
    const nameEn        = idxNameEn >= 0 ? row[idxNameEn] : null;
    const emissionLines = idxEmLines >= 0 ? row[idxEmLines] : null;

    // Track source coverage
    const hasA = catalogs.some(c => pdf750[c] !== undefined);
    const hasB = catalogs.some(c => (c.startsWith('NGC') || c.startsWith('IC')) && agMap.has(c));
    if (hasA && hasB) nBoth++;
    else if (hasA)    nSourceA++;
    else if (hasB)    nSourceB++;
    else              nHeuristic++;

    // Compute rating + difficulty
    let rating = computeRating({ catalogs, type, mag, majAxis, nameFr, nameEn, pdf750, agMap });
    rating = applyRatingFloors(rating, catalogs);
    const difficulty = computeDifficulty({ catalogs, type, mag, majAxis, emissionLines, surfBrMap, agMap });

    row.push(rating, difficulty);
    ratingDist[rating]++;
    diffDist[difficulty]++;

    // Spot-check output
    const primaryId = row[idxId];
    if (SPOT_CHECKS.has(primaryId) || catalogs.some(c => SPOT_CHECKS.has(c))) {
      console.log(`  SPOT [${catalogs.join(',')}] → rating=${rating} diff=${difficulty}`);
    }
  }

  console.log('\n─── Rating distribution ───');
  for (let i = 1; i <= 5; i++) console.log(`  ${i}★: ${ratingDist[i].toLocaleString()}`);
  console.log('\n─── Difficulty distribution ───');
  for (let i = 1; i <= 5; i++) console.log(`  diff ${i}: ${diffDist[i].toLocaleString()}`);
  console.log('\n─── Source coverage ───');
  console.log(`  Both A+B: ${nBoth}, A only: ${nSourceA}, B only: ${nSourceB}, Heuristic: ${nHeuristic}`);

  // Write patched file
  fs.writeFileSync(DSO_JSON_PATH, JSON.stringify(dsoJson));
  console.log(`\n✓ Patched ${dsoJson.data.length.toLocaleString()} DSOs → ${DSO_JSON_PATH}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
