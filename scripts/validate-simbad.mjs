#!/usr/bin/env node
/**
 * validate-simbad.mjs
 *
 * Cross-checks DSO catalog entries against SIMBAD (CDS Strasbourg).
 * SIMBAD is the authoritative source for object identification, coordinates,
 * and cross-catalog references.
 *
 * What it checks:
 *  1. Coordinate drift   — our RA/Dec vs SIMBAD (flags > threshold)
 *  2. Name mismatch      — our nameEn appears in SIMBAD under a DIFFERENT object
 *  3. Unknown identifier — SIMBAD doesn't recognise the ID at all
 *  4. Cross-ID gaps      — SIMBAD knows extra catalog aliases we're missing
 *
 * Scope (configurable via --scope):
 *  named  — 184 objects that have a proper nameEn (highest risk)
 *  sh2    — all 259 Sharpless objects
 *  lbn    — all 873 LBN objects
 *  all    — everything (slow, ~12 k requests in batches)
 *
 * Usage:
 *   node scripts/validate-simbad.mjs [--scope named|sh2|lbn|all] [--deg 0.5]
 *
 * Output: console report + optional JSON report file (--out report.json)
 */

import fs from 'fs';
import https from 'https';
import { URL } from 'url';

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const scope = args[args.indexOf('--scope') + 1] ?? 'named';
const degThreshold = parseFloat(args[args.indexOf('--deg') + 1] ?? '0.5');
const outFile = args.indexOf('--out') >= 0 ? args[args.indexOf('--out') + 1] : null;

// ── Load catalog ──────────────────────────────────────────────────────────────
const dsoJson = JSON.parse(fs.readFileSync('public/data/dso.json', 'utf8'));
const fields = dsoJson.fields;
const idIdx = fields.indexOf('id');
const raIdx = fields.indexOf('ra');
const decIdx = fields.indexOf('dec');
const nameEnIdx = fields.indexOf('nameEn');
const catIdx = fields.indexOf('catalogs');

/** @param {any[]} row */
const row = (r) => ({
  id: r[idIdx],
  ra: r[raIdx],
  dec: r[decIdx],
  nameEn: r[nameEnIdx],
  catalogs: r[catIdx] ?? [],
});

let targets = dsoJson.data.map(row);

switch (scope) {
  case 'named':
    targets = targets.filter((t) => t.nameEn);
    break;
  case 'sh2':
    targets = targets.filter((t) => t.id.startsWith('SH2-'));
    break;
  case 'lbn':
    targets = targets.filter((t) => t.id.startsWith('LBN'));
    break;
  case 'all':
    break;
  default:
    console.error(`Unknown scope: ${scope}. Use named|sh2|lbn|all`);
    process.exit(1);
}

console.log(`Scope: ${scope} → ${targets.length} objects to check`);
console.log(`Coordinate threshold: ${degThreshold}°`);
console.log(`SIMBAD TAP endpoint: https://simbad.cds.unistra.fr/simbad/sim-tap/sync`);
console.log('─'.repeat(70));

// ── ID normalisation: our format → SIMBAD format ─────────────────────────────
// SIMBAD generally accepts catalog identifiers with either a space or hyphen.
// Some normalisation helps hit rate.
function toSimbadId(id) {
  // SH2-240  → Sh2-240  (SIMBAD requires hyphen, not space)
  if (/^SH2-/i.test(id)) return 'Sh2-' + id.slice(4);
  // LBN873   → LBN 873
  if (/^LBN\d/.test(id)) return 'LBN ' + id.slice(3);
  // LDN846   → LDN 846
  if (/^LDN\d/.test(id)) return 'LDN ' + id.slice(3);
  // vdB107   → vdB 107
  if (/^vdB\d/.test(id)) return 'vdB ' + id.slice(3);
  // NGC7009  → NGC 7009
  if (/^NGC\d/.test(id)) return 'NGC ' + id.slice(3);
  // IC1805   → IC 1805
  if (/^IC\d/.test(id)) return 'IC ' + id.slice(2);
  // M31      → M 31
  if (/^M\d/.test(id)) return 'M ' + id.slice(1);
  // LPN-Abell36 → PN A66 36  (avoids hitting galaxy clusters ACO N)
  if (/^LPN-Abell(\d+)$/.test(id)) return 'PN A66 ' + id.slice(9);
  // LPN-Sh2216  → Sh2-216
  if (/^LPN-Sh2(\d+)$/.test(id)) return 'Sh2-' + id.slice(7);
  // LPN-XXX — strip prefix and insert space before trailing number
  if (/^LPN-/.test(id)) {
    const name = id.slice(4);
    // Insert space before trailing digits: "WeDe1" → "WeDe 1", "HFG1" → "HFG 1"
    return name.replace(/([A-Za-z])(\d+)$/, '$1 $2').replace(/-/g, ' ');
  }
  return id;
}

// ── SIMBAD TAP query ──────────────────────────────────────────────────────────
const TAP_URL = 'https://simbad.cds.unistra.fr/simbad/sim-tap/sync';

/** Fetch a URL, return body as string */
function httpGet(urlStr) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const options = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers: { 'User-Agent': 'my-astro-sky-validator/1.0' },
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.end();
  });
}

/**
 * Query SIMBAD TAP for a single identifier.
 * Returns { main_id, ra, dec, otype, ids } or null if not found.
 */
async function querySimbad(simbadId) {
  const adql = `SELECT b.main_id, b.ra, b.dec, b.otype, ids.ids
FROM ident i
JOIN basic b ON b.oid = i.oidref
JOIN ids ON b.oid = ids.oidref
WHERE i.id = '${simbadId.replace(/'/g, "''")}'`;

  const url = `${TAP_URL}?REQUEST=doQuery&LANG=ADQL&FORMAT=json&QUERY=${encodeURIComponent(adql)}`;
  try {
    const body = await httpGet(url);
    const json = JSON.parse(body);
    if (!json.data || json.data.length === 0) return null;
    const [main_id, ra, dec, otype, ids] = json.data[0];
    return { main_id, ra, dec, otype, ids };
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * Query SIMBAD by proper name (to check if our nameEn is assigned to the right object).
 * Returns the object SIMBAD maps this name to, or null.
 */
async function querySimbadByName(name) {
  return querySimbad(name);
}

// ── Angular separation ────────────────────────────────────────────────────────
function angSep(ra1, dec1, ra2, dec2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const d1 = toRad(dec1),
    d2 = toRad(dec2);
  const dra = toRad(ra2 - ra1);
  const cos = Math.sin(d1) * Math.sin(d2) + Math.cos(d1) * Math.cos(d2) * Math.cos(dra);
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
}

// ── Rate-limited queue ────────────────────────────────────────────────────────
const DELAY_MS = 500; // 2 requests/sec — respectful to SIMBAD
async function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Main validation loop ──────────────────────────────────────────────────────
const issues = [];

let processed = 0;
for (const t of targets) {
  processed++;
  const simbadId = toSimbadId(t.id);
  process.stdout.write(`[${processed}/${targets.length}] ${t.id} (→ ${simbadId}) ... `);

  const result = await querySimbad(simbadId);
  await delay(DELAY_MS);

  if (!result) {
    process.stdout.write('NOT FOUND\n');
    issues.push({
      id: t.id,
      type: 'not_found',
      simbadId,
      note: 'SIMBAD does not recognise this identifier',
    });
    continue;
  }

  if (result.error) {
    process.stdout.write(`ERROR: ${result.error}\n`);
    issues.push({ id: t.id, type: 'error', simbadId, note: result.error });
    continue;
  }

  const flags = [];

  // 1. Coordinate check
  if (result.ra != null && result.dec != null) {
    const sep = angSep(t.ra, t.dec, result.ra, result.dec);
    if (sep > degThreshold) {
      flags.push(
        `coord_drift: our (${t.ra.toFixed(3)}, ${t.dec.toFixed(3)}) vs SIMBAD (${Number(result.ra).toFixed(3)}, ${Number(result.dec).toFixed(3)}) — sep=${sep.toFixed(2)}°`,
      );
    }
  }

  // 2. Name check: only for *distinctive* proper names, not generic "Open Cluster M47" labels.
  //    Strip common generic prefixes + trailing catalog IDs, then check the core name.
  if (t.nameEn) {
    const GENERIC_PREFIXES = [
      'open cluster',
      'globular cluster',
      'spiral galaxy',
      'elliptical galaxy',
      'dwarf elliptical galaxy',
      'reflection nebula',
      'emission nebula',
      'planetary nebula',
      'asterism',
      'galaxy cluster',
    ];
    let coreName = t.nameEn.toLowerCase();
    GENERIC_PREFIXES.forEach((p) => {
      if (coreName.startsWith(p)) coreName = coreName.slice(p.length).trim();
    });
    // Strip trailing catalog ID (e.g. "m47", "ngc1234", "ic5146")
    coreName = coreName.replace(/\s+(m\s*\d+|ngc\s*\d+|ic\s*\d+|sh2-\d+|lbn\s*\d+)$/i, '').trim();

    // Only check if a non-trivial distinctive name remains
    if (coreName.length > 3 && !/^[a-z]?\d+$/.test(coreName)) {
      const simbadNames = (result.ids || '').split('|').map((s) => s.trim().toLowerCase());
      // Check all SIMBAD ids + the raw simbad "name XXX" entries
      const nameFound = simbadNames.some(
        (n) => n.includes(coreName) || coreName.includes(n.replace(/^name\s+/, '')),
      );
      if (!nameFound) {
        const mainIdLower = (result.main_id || '').toLowerCase();
        if (!mainIdLower.includes(coreName)) {
          flags.push(
            `name_mismatch: core name "${coreName}" (from nameEn="${t.nameEn}") not found in SIMBAD ids for ${result.main_id}`,
          );
        }
      }
    }
  }

  // 3. Cross-ID check: does SIMBAD's main_id suggest this is a different object than expected?
  // Example: if we have id=SH2-147 but SIMBAD says main_id is "SH2-240", that's a naming confusion.
  const simbadMainLower = (result.main_id || '').toLowerCase();
  const ourIdLower = simbadId.toLowerCase();
  // Check each of our catalog IDs against SIMBAD's ids
  const simbadIdSet = new Set(
    (result.ids || '').split('|').map((s) => s.trim().toLowerCase().replace(/\s+/g, '')),
  );
  for (const cat of t.catalogs) {
    const normCat = cat.toLowerCase().replace(/\s+/g, '');
    const normSimbad = toSimbadId(cat).toLowerCase().replace(/\s+/g, '');
    if (!simbadIdSet.has(normCat) && !simbadIdSet.has(normSimbad)) {
      // Catalog ID we claim but SIMBAD doesn't list for this object
      if (cat !== t.id) {
        // skip the primary id itself (already looked it up)
        flags.push(
          `catalog_id_missing: we list "${cat}" as an alias, but SIMBAD does not associate it with ${result.main_id}`,
        );
      }
    }
  }

  if (flags.length > 0) {
    process.stdout.write(`⚠ ${flags.length} issue(s)\n`);
    flags.forEach((f) => process.stdout.write(`       → ${f}\n`));
    issues.push({
      id: t.id,
      simbadId,
      simbadMainId: result.main_id,
      ourCoords: [t.ra, t.dec],
      simbadCoords: [result.ra, result.dec],
      ourNameEn: t.nameEn,
      flags,
    });
  } else {
    process.stdout.write(`OK (${result.main_id})\n`);
  }
}

// ── Also check: do any of our nameEn strings map to a DIFFERENT object in SIMBAD? ──
// This catches the "name assigned to wrong ID" case (like old Simeis 147 / SH2-147 bug).
console.log('\n' + '─'.repeat(70));
console.log('Phase 2: checking proper names resolve to the expected object in SIMBAD...');
console.log('─'.repeat(70));

const namedTargets = targets.filter((t) => {
  if (!t.nameEn) return false;
  // Skip generic descriptive labels — only query distinctive proper names
  const GENERIC_PREFIXES = [
    'open cluster',
    'globular cluster',
    'spiral galaxy',
    'elliptical galaxy',
    'dwarf elliptical galaxy',
    'reflection nebula',
    'emission nebula',
    'planetary nebula',
    'asterism',
    'galaxy cluster',
  ];
  const lower = t.nameEn.toLowerCase();
  return !GENERIC_PREFIXES.some((p) => lower.startsWith(p));
});
for (const t of namedTargets) {
  process.stdout.write(`[name] "${t.nameEn}" (expected: ${t.id}) ... `);
  const result = await querySimbadByName(t.nameEn);
  await delay(DELAY_MS);

  if (!result || result.error) {
    process.stdout.write(`not found by name (OK — not all names are in SIMBAD)\n`);
    continue;
  }

  // Check if SIMBAD's ids for this object include our expected ID
  const simbadIdSet = new Set(
    (result.ids || '').split('|').map((s) =>
      s
        .trim()
        .toLowerCase()
        .replace(/[-\s]+/g, ''),
    ),
  );
  const ourNormId = toSimbadId(t.id)
    .toLowerCase()
    .replace(/[-\s]+/g, '');
  if (!simbadIdSet.has(ourNormId)) {
    const note = `"${t.nameEn}" resolves in SIMBAD to ${result.main_id}, but our catalog assigns this name to ${t.id} — possible wrong assignment`;
    process.stdout.write(`⚠ ${note}\n`);
    issues.push({ id: t.id, type: 'name_wrong_object', note, simbadMainId: result.main_id });
  } else {
    process.stdout.write(`OK (resolves to ${result.main_id})\n`);
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(70));
console.log(
  `VALIDATION COMPLETE — ${issues.length} issue(s) found across ${targets.length} objects`,
);

const byType = {};
issues.forEach((i) => {
  const types = i.flags ? i.flags.map((f) => f.split(':')[0]) : [i.type ?? 'unknown'];
  types.forEach((t) => {
    byType[t] = (byType[t] ?? 0) + 1;
  });
});
Object.entries(byType).forEach(([t, n]) => console.log(`  ${t}: ${n}`));

if (outFile) {
  fs.writeFileSync(outFile, JSON.stringify(issues, null, 2));
  console.log(`\nFull report written to ${outFile}`);
}
