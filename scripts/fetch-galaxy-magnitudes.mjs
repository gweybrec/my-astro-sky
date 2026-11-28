#!/usr/bin/env node
/**
 * fetch-galaxy-magnitudes.mjs
 *
 * Writes scripts/galaxy-magnitudes.json: a V magnitude for each OpenNGC galaxy whose own
 * V is missing or impossible (fainter than its B: a central-aperture value, e.g. NGC 2606
 * at V 17.02 against B 14.90). generate-dso.mjs uses it in place of OpenNGC's V.
 *
 * Sources, best first:
 *   rc3     RC3 (VizieR VII/155) total magnitude: V = BT − (B−V)T
 *   sdss    SDSS DR18 cModel g, r of the nearest galaxy within 0.5′:
 *           V = g − 0.59 (g − r) − 0.01 (Jester et al. 2005). Rejected when the matching
 *           B (g + 0.39 (g − r) + 0.21) is more than 1 mag from a catalogue B (a piece of
 *           the galaxy or a bad measurement), or when g, r are out of range.
 *   b-est   a B magnitude (RC3 BT, else OpenNGC B, else RC3 photographic) minus the
 *           median B − V of the galaxies of its kind measured here (elliptical/S0,
 *           spiral, irregular). About ±0.3 mag.
 *
 * Pairs, triplets and groups get no SDSS value (the nearest object is one member).
 * Run it after an OpenNGC update: node scripts/fetch-galaxy-magnitudes.mjs (about 2 min).
 */

import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { cdsFile, fetchText } from './fetch-text.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, 'galaxy-magnitudes.json');
const OPENNGC_URL =
  'https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/NGC.csv';
const SDSS_SQL_URL = 'https://skyserver.sdss.org/dr18/SkyServerWS/SearchTools/SqlSearch';
const SDSS_BATCH = 80; // positions per query (the service takes GET only, so the URL stays short)

const sexToDeg = (s, hours) => {
  if (!s) return null;
  const [a, b, c] = s.split(':').map(Number);
  const deg = Math.abs(a) + b / 60 + c / 3600;
  return (s.trim().startsWith('-') ? -deg : deg) * (hours ? 15 : 1);
};
const num = (s) => (s === undefined || s.trim() === '' ? null : Number(s));

/** OpenNGC galaxies: id → { ra, dec, V, B, hubble, single } */
function parseOpenNGC(text) {
  const lines = text.split('\n');
  const h = lines[0].split(';');
  const col = (name) => h.indexOf(name);
  const out = new Map();
  for (const line of lines.slice(1)) {
    const p = line.split(';');
    const type = p[col('Type')];
    if (!['G', 'GPair', 'GTrpl', 'GGroup'].includes(type)) continue;
    const m = p[col('Name')]?.match(/^(NGC|IC)0*(\d+)$/);
    if (!m) continue;
    out.set(m[1] + m[2], {
      ra: sexToDeg(p[col('RA')], true),
      dec: sexToDeg(p[col('Dec')], false),
      V: num(p[col('V-Mag')]),
      B: num(p[col('B-Mag')]),
      hubble: p[col('Hubble')]?.trim() ?? '',
      single: type === 'G',
    });
  }
  return out;
}

/** RC3: "NGC2606" → { BT, BV, mB } (byte columns from the VII/155 ReadMe). */
function parseRC3(text) {
  const out = new Map();
  for (const l of text.split('\n')) {
    if (l.length < 260) continue;
    const f = (a, b) => l.slice(a - 1, b).trim();
    const n = (a, b) => (f(a, b) === '' ? null : Number(f(a, b)));
    const rec = { BT: n(190, 194), mB: n(201, 205), BV: n(253, 256) };
    for (const name of [f(63, 74), f(75, 89)]) {
      const m = name.match(/^(NGC|IC)\s*0*(\d+)$/);
      if (m) out.set(m[1] + m[2], rec);
    }
  }
  return out;
}

/** SDSS DR18 cModel g, r of the galaxy nearest each position: id → { g, r } */
async function fetchSDSS(targets) {
  const out = new Map();
  for (let i = 0; i < targets.length; i += SDSS_BATCH) {
    const values = targets
      .slice(i, i + SDSS_BATCH)
      .map(([id, ra, dec]) => `('${id}',${ra},${dec})`)
      .join(',');
    const sql =
      `SELECT t.id, g.cModelMag_g AS g, g.cModelMag_r AS r FROM (VALUES ${values}) AS t(id,ra,dec) ` +
      'CROSS APPLY dbo.fGetNearestObjEq(t.ra,t.dec,0.5) AS n JOIN Galaxy AS g ON g.objid=n.objid';
    const url = `${SDSS_SQL_URL}?format=json&cmd=${encodeURIComponent(sql)}`;
    const rows = JSON.parse(await fetchText(url, 'SDSS galaxy magnitudes'))[0].Rows;
    for (const row of rows) out.set(row.id, { g: row.g, r: row.r });
    process.stdout.write(`  SDSS: ${Math.min(i + SDSS_BATCH, targets.length)}/${targets.length}\r`);
  }
  process.stdout.write('\n');
  return out;
}

/** Colour group for the B − V estimate. */
function colourGroup(hubble) {
  if (/^E|^cD|^S[AB]?0/.test(hubble)) return 'early';
  if (/^I|^Sm$|^SBm$|^SABm$|^BCD$|^dIrr/.test(hubble)) return 'irregular';
  return 'spiral';
}

const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const round = (v) => Math.round(v * 100) / 100;

async function main() {
  console.log('Downloading OpenNGC and RC3...');
  const [ngcText, rc3Text] = await Promise.all([
    fetchText(OPENNGC_URL, 'the OpenNGC catalogue'),
    cdsFile('VII/155/rc3.gz', 'the RC3 galaxy catalogue', { gzip: true }),
  ]);
  const galaxies = parseOpenNGC(ngcText);
  const rc3 = parseRC3(rc3Text);
  const needs = [...galaxies].filter(([, g]) => g.V === null || (g.B !== null && g.V > g.B));
  console.log(`${needs.length} galaxies without a usable V (of ${galaxies.size})`);

  const sdss = await fetchSDSS(
    needs.filter(([, g]) => g.single && g.ra !== null).map(([id, g]) => [id, g.ra, g.dec]),
  );

  const catalogueB = (id) => rc3.get(id)?.BT ?? galaxies.get(id).B ?? rc3.get(id)?.mB ?? null;
  const sdssV = (id) => {
    const s = sdss.get(id);
    if (!s || !(s.g > 5 && s.g < 21 && s.r > 5 && s.r < 21)) return null;
    const gr = s.g - s.r;
    if (gr < -0.2 || gr > 1.6) return null;
    const b = catalogueB(id);
    if (b !== null && Math.abs(s.g + 0.39 * gr + 0.21 - b) > 1) return null;
    return s.g - 0.59 * gr - 0.01;
  };

  // B − V per colour group, from the galaxies that have both a catalogue B and an SDSS V
  const samples = { early: [], spiral: [], irregular: [] };
  for (const [id, g] of needs) {
    const v = sdssV(id);
    const b = catalogueB(id);
    if (v !== null && b !== null) samples[colourGroup(g.hubble)].push(b - v);
  }
  const colour = Object.fromEntries(
    Object.entries(samples).map(([k, a]) => [k, round(a.length ? median(a) : 0.7)]),
  );
  console.log('Median B − V:', colour);

  const magnitudes = {};
  const counts = { rc3: 0, sdss: 0, 'b-est': 0, none: 0 };
  for (const [id, g] of needs) {
    const r = rc3.get(id);
    let entry = null;
    if (r?.BT != null && r?.BV != null) entry = [round(r.BT - r.BV), 'rc3'];
    else if (sdssV(id) !== null) entry = [round(sdssV(id)), 'sdss'];
    else if (catalogueB(id) !== null)
      entry = [round(catalogueB(id) - colour[colourGroup(g.hubble)]), 'b-est'];
    counts[entry ? entry[1] : 'none']++;
    if (entry) magnitudes[id] = entry;
  }
  console.log(counts);

  const sorted = Object.fromEntries(
    Object.entries(magnitudes).sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true })),
  );
  writeFileSync(
    OUT_PATH,
    JSON.stringify({
      about:
        'V magnitudes of OpenNGC galaxies whose own V is missing or fainter than their B. [V, source]: rc3 = RC3 BT − (B−V)T, sdss = SDSS DR18 g,r (Jester 2005), b-est = catalogue B − median B−V. Built by scripts/fetch-galaxy-magnitudes.mjs.',
      colourBV: colour,
      magnitudes: sorted,
    }) + '\n',
  );
  console.log(`✓ Wrote ${Object.keys(sorted).length} magnitudes → ${OUT_PATH}`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
