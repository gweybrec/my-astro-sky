#!/usr/bin/env node
/**
 * seed-filter-colors.mjs
 * Seeds the `color` field (badge colour, #rrggbb) on every entry of
 * resources/filters.json.
 *
 * Idempotent by design: an entry that already carries a `color` is left
 * untouched, so hand-picked overrides survive a re-run after new filters are
 * appended to the catalog.
 *
 * The base hues mirror the legacy `--filter-*` tokens in src/styles/tokens.css
 * so a catalog badge sits naturally next to a generic one (Ha red, OIII blue,
 * SII magenta, LRGB neutral/primaries, dual-band violet). Bands with no legacy
 * token (tri/quad-band, light pollution, solar, Hβ/NII/near-IR) get their own
 * distinct hue.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILTERS_PATH = path.join(__dirname, '..', 'resources', 'filters.json');

// ─── Colour map ───────────────────────────────────────────────────────────────

/** Keyed on `subtype` — checked first, exact match. */
const BY_SUBTYPE = {
  // Narrowband emission lines (legacy tokens)
  Ha: '#b42828',
  'Ha solar': '#d2461e',
  OIII: '#1e64c8',
  SII: '#a03ca0',
  Hβ: '#3ca0c8',
  NII: '#c85a32',

  // Broadband LRGB (legacy tokens)
  luminance: '#c8c8c8',
  clear: '#c8c8c8',
  'UV/IR cut': '#8ca0b4',
  'DSLR LPF': '#8ca0b4',
  'DSLR LPF Ha-modified': '#a08296',
  'DSLR LPF replacement': '#8ca0b4',
  red: '#c83c3c',
  green: '#32b450',
  'green/visual': '#32b450',
  blue: '#2850c8',
  'blue/green': '#2896b4',
  'near-IR': '#96506e',
  'LRGB set': '#bebed2',

  // Multi-band (legacy dual-band token, then its own family)
  'Ha+OIII': '#501e96',
  'Ha+OIII+Hβ': '#6428aa',
  'Ha+OIII+SII': '#7828be',
  'Ha+OIII+SII+Hβ': '#8c28c8',

  // Light pollution
  'LPS broadband': '#c8901e',
  UHC: '#b4a028',
  CLS: '#c87d28',
  skyglow: '#a08c32',
  broadband_lp: '#b48c3c',

  // Solar
  'CaK solar': '#5a78c8',
  'Solar continuum': '#c8b43c',
  'Solar ND 3.8': '#8c8c8c',
};

/** Fallback keyed on `type`, used when the subtype is unknown. */
const BY_TYPE = {
  broadband: '#bebed2',
  narrowband: '#b42828',
  dual_narrowband: '#501e96',
  triband_narrowband: '#7828be',
  quadband_narrowband: '#8c28c8',
  light_pollution: '#c8901e',
  solar_narrowband: '#d2461e',
  solar_nd: '#8c8c8c',
  none: '#6478a0',
};

const DEFAULT_COLOR = '#2850a0'; // matches --filter-custom

function seedColor(entry) {
  return BY_SUBTYPE[entry.subtype] ?? BY_TYPE[entry.type] ?? DEFAULT_COLOR;
}

// ─── Run ──────────────────────────────────────────────────────────────────────

const filters = JSON.parse(fs.readFileSync(FILTERS_PATH, 'utf-8'));

let seeded = 0;
let kept = 0;
let normalized = 0;

for (const entry of filters) {
  // `current` is not a valid status value — the schema enum expects `active`.
  if (entry.status === 'current') {
    entry.status = 'active';
    normalized++;
  }

  if (typeof entry.color === 'string' && /^#[0-9a-f]{6}$/i.test(entry.color)) {
    kept++;
    continue;
  }
  entry.color = seedColor(entry);
  seeded++;
}

// Guard the invariant the runtime depends on: the display label
// (astrobin_name → spcc_name → model) is the lookup key used to colour a badge,
// so it has to be unique across the catalog.
const seen = new Map();
const collisions = [];
for (const entry of filters) {
  const label = entry.astrobin_name ?? entry.spcc_name ?? entry.model;
  const key = label.trim().toLowerCase();
  if (seen.has(key)) collisions.push(`${label}  (${seen.get(key)} / ${entry.id})`);
  else seen.set(key, entry.id);
}
if (collisions.length > 0) {
  console.error(`Duplicate display labels found:\n  ${collisions.join('\n  ')}`);
  process.exit(1);
}

fs.writeFileSync(FILTERS_PATH, JSON.stringify(filters, null, 2) + '\n', 'utf-8');

console.log(
  `filters.json: ${seeded} colour(s) seeded, ${kept} kept, ${normalized} status value(s) normalized (${filters.length} total).`,
);
