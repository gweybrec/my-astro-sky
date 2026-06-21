---
name: add-dso-catalog
description: >
  Add a new external DSO catalog (e.g. RCW, vdBH) to the sky map.
  Use when asked to integrate a new catalog, wire it into generate-dso.mjs, add its
  prefix to dso-catalog.ts, add i18n labels (4 languages), and validate against SIMBAD.
  Trigger phrases: "add catalog", "new catalog", "integrate catalog", "wire catalog",
  "add DSO catalog", "new object catalog".
---

# Add a New DSO Catalog

This skill guides you through integrating a new external DSO catalog (e.g. RCW, van den Bergh-Hagen, etc.) into the sky map. It follows the same pattern used to add LBN, LDN, vdB, Abell, and Barnard.

> **Verify line numbers and current code before editing — this skill names files, not exact line numbers.** The codebase moves. The constants and helpers below have already relocated once (out of `ui.ts`). Always `grep`/Read the real current state of each file before applying an edit shown here.

## Unit Test Plan (mandatory, part of the plan)

Before writing any code, the plan must explicitly address unit tests:

- **List every test file to create or update**, with a brief description of what each test covers.
- If a `parseXXX` introduces a genuinely new coordinate-math path (not just reading columns), that math is the thing to cover — but note `generate-dso.mjs` itself is not in the vitest scope (see below), so in practice this means reusing/extending coverage of the underlying helper, not testing `parseXXX` directly.
- Reusing an existing coordinate helper (`precess1950to2000`, `galacticToEquatorial`) that already has coverage does not require new tests for the helper itself, but the plan must confirm the existing tests cover the conversion path being used.
- If no unit test changes are needed, the plan must **state the justification** (e.g. "parse function is a trivial split with no branching; coordinate path is identical to the already-tested LDN path").
- Identifying tests is part of the plan, not an afterthought. A plan that omits this section is incomplete.

**Always required:** `tests/unit/dso-catalog.test.ts` has a parametrized `getDSOCatalog()` table (`it.each([...])`). Add a row for the new prefix, e.g. `['XXX123', 'XXX']`. Editing `src/dso-catalog.ts` triggers the vitest PostToolUse hook, so this surfaces immediately.

**Usually not required:** `generate-dso.mjs` is a build-time script that no test imports and is outside the vitest scope — none of the existing `parseLBN`/`parseLDN`/`parseVdB`/`parseBarnard` functions are unit-tested. A new `parseXXX` only needs a test if it does non-trivial coordinate math that isn't already covered by `precess1950to2000`/`galacticToEquatorial`. If it reads a precomputed J2000 column (no conversion), state that as the justification and verify via the regeneration spot-checks instead.

Tests live in `tests/unit/`. Run with `npm test`.

---

## Overview of touched files

1. `scripts/generate-dso.mjs` — download, parse, merge, and output to `dso.json`
2. `public/data/dso.json` — regenerated artifact (run the script)
3. `src/dso-catalog.ts` — **three** things: the `DSOCatalog` type union, `getDSOCatalog()`, `catalogSortKey()`, **and** the `DSO_CATALOGS_ALL` array (all live here, NOT in `ui.ts`)
4. `src/display-settings.ts` — `DSO_CATALOGS_DEFAULT_ON` set (only change if on-by-default)
5. `src/sky-map.ts` — label formatting `.replace()` chain; `visibleDSOCatalogs` default set (only if on at startup)
6. `src/i18n/fr.ts`, `en.ts`, `es.ts`, `de.ts` — `catalogLabels` key in **all four** languages
7. `tests/unit/dso-catalog.test.ts` — add a row to the `getDSOCatalog()` parametrized test
8. `scripts/dso-metadata-overrides.json` — names / constellation / rating / difficulty for notable objects (optional but recommended)

> The constants `DSO_CATALOGS_ALL`, `getDSOCatalog`, and `catalogSortKey` moved out of `ui.ts` into `src/dso-catalog.ts`, and `DSO_CATALOGS_DEFAULT_ON` lives in `src/display-settings.ts`. If a step below references `ui.ts`, treat it as historical and find the real location.

## Custom DSO metadata

MyAstroSky keeps a small hand-maintained override file at `scripts/dso-metadata-overrides.json` for metadata that is not reliably available in raw catalog sources. This file is the authoritative reference for:

- `constellation`: the IAU constellation short code shown on target cards and chips
- `rating`: target interest rating 1–5 used by the Targets UI
- `difficulty`: imaging difficulty 1–5 used by recipe and filter logic

When a new catalog is added, its objects will appear in `public/data/dso.json` after regeneration, but they will not automatically get these custom metadata values. If you want new catalog objects to show constellation chips, interest stars, and difficulty diamonds, add the corresponding entries to `scripts/dso-metadata-overrides.json` first, then rerun `node scripts/generate-dso.mjs`.

New catalogs therefore have two maintenance steps:

1. wire the catalog into `generate-dso.mjs` so the objects are generated
2. add any `constellation`, `rating`, and `difficulty` values to `scripts/dso-metadata-overrides.json`

If you skip the second step, the objects still exist in the map, but the target metadata will be missing until it is added to the override file.

---

## Step 1 — Decide the catalog details

Before writing any code, pin down:

| Question | LBN | LDN | vdB | Barnard |
|---|---|---|---|---|
| Prefix (catalog key) | `LBN` | `LDN` | `vdB` | `Barnard` |
| Full name | Lynds Bright Nebulae | Lynds Dark Nebulae | van den Bergh | Barnard Dark Objects |
| DSO type code | `EN`/`RN` | `DN` | `RN` | `DN` |
| Source (VizieR FTP) | `VII/9/catalog.dat` | `VII/7A/ldn` | `VII/21/catalog.dat` | `VII/220A/barnard.dat` |
| Epoch / coord system | B1950 RA/Dec | B1950 RA/Dec | Galactic l,b | **J2000 RA/Dec (provided directly)** |
| On by default? | No | No | No | No |
| Cross-refs in OpenNGC `Identifiers`? | Yes (`LBN NNN`) | No | No | **No — none at all** |

The **prefix can be spelled out** (e.g. `Barnard`, not `B`) — confirm the user's preference, since it sets the on-map label and every id. Avoid single-letter prefixes: they collide inside other ids (a literal `B` is a substring of `LBN`) and break the label formatter (see Step 6b).

Use VizieR (https://vizier.cds.unistra.fr) to find the catalog's FTP path and column layout.

> **VizieR access (verified 2026):** The VizieR *website / ReadMe pages / directory listings over HTTPS* are behind the **Anubis** JS-challenge — `WebFetch` and a browser get an "Access Denied" page. **But two paths still work:**
> 1. **The build script's plain `fetch()` to the HTTPS `/ftp/` data file path works fine** — `fetchLBN`/`fetchLDN`/`fetchVdB`/`fetchBarnard` all use `https://cdsarc.cds.unistra.fr/ftp/VII/.../file.dat` and download successfully when `node scripts/generate-dso.mjs` runs. So keep using the HTTPS `/ftp/` URL in `fetchXXX()`.
> 2. **To read the ReadMe / list a directory during research, use the real FTP protocol via `curl`** (Anubis only guards HTTP):
>    ```bash
>    curl -s "ftp://cdsarc.cds.unistra.fr/cats/VII/220A/"           # directory listing
>    curl -s "ftp://cdsarc.cds.unistra.fr/cats/VII/220A/ReadMe"     # byte-offset table
>    curl -s "ftp://cdsarc.cds.unistra.fr/cats/VII/220A/barnard.dat" | head   # sample rows
>    ```
>    Note the path difference: HTTPS uses `/ftp/VII/...`, the FTP protocol uses `/cats/VII/...`.

---

## Step 2 — Add fetch + parse functions to `generate-dso.mjs`

### 2a. Fetch function

Add after the existing `fetchLDN` function:

```js
async function fetchXXX() {
  const url = 'https://cdsarc.cds.unistra.fr/ftp/...';   // VizieR FTP path
  console.log('Downloading XXX catalog...');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`XXX HTTP ${res.status}`);
  return res.text();
}
```

### 2b. Parse function

Fixed-width VizieR files: use `substring(col, col+width).trim()`.
CSV files: split on delimiter.

```js
// Returns array of { id, ra50, dec50, <other fields> }
function parseXXX(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    // Example fixed-width parse (adjust columns to ReadMe file):
    const id   = parseInt(line.substring(0, 4).trim());
    const rah  = parseFloat(line.substring(5, 7).trim());
    const ram  = parseFloat(line.substring(8, 12).trim());
    const decd = parseFloat(line.substring(13, 15).trim());
    const decm = parseFloat(line.substring(16, 18).trim());
    const diam = parseFloat(line.substring(20, 25).trim()) || null;

    if (isNaN(id)) continue;

    const ra50  = (rah + ram / 60) * 15;          // h,m → degrees
    const dec50 = decd + decm / 60;               // +/- handle separately
    entries.push({ id, ra50, dec50, diam });
  }
  return entries;
}
```

**Coordinate conversion** — read the ReadMe's epoch carefully, then pick one:
- **J2000 RA/Dec already in the file**: no conversion. **Check for this first** — many "old-epoch" VizieR catalogs include a precomputed J2000 column alongside the historical one. Barnard (`VII/220A`) lists *both* B1875 and J2000 (bytes 23–44); read the J2000 columns and ignore B1875 entirely. Don't precess what's already precessed.
- **B1950 RA/Dec** (e.g. LBN, LDN): use `precess1950to2000(ra50, dec50)` → `{ ra, dec }` J2000 degrees.
- **Galactic (l, b)** (e.g. vdB, `VII/21`): use `galacticToEquatorial(l_deg, b_deg)` → `{ ra, dec }` J2000 degrees.

> The original published Barnard catalogue was epoch 1875.0; **do not assume "old catalog ⇒ galactic" or "⇒ B1950"**. Barnard is equatorial with a precomputed J2000 column. Verify per catalog from the ReadMe.

When reading fixed-width columns, remember JS `substring` is **0-indexed** while VizieR ReadMe byte ranges are **1-indexed and inclusive**: ReadMe "bytes 23-24" → `line.substring(22, 24)`. Also handle blank optional sub-fields (e.g. Barnard's seconds-of-RA column is sometimes empty → default to 0), and trim before `parseInt`/`parseFloat`.

---

## Step 3 — Wire into `main()` in `generate-dso.mjs`

### 3a. Download at top of main

```js
let xxxEntries = [];
try {
  const xxxText = await fetchXXX();
  xxxEntries = parseXXX(xxxText);
  console.log(`Parsed ${xxxEntries.length} XXX entries`);
} catch (e) {
  console.warn(`Warning: could not fetch XXX: ${e.message}`);
}
```

### 3b. Handle cross-refs / merging (avoid duplicate markers)

The goal is to avoid drawing a new marker on top of an object that's already in the catalog. There are **two distinct mechanisms** — pick based on whether OpenNGC actually knows your catalog.

**FIRST, check whether OpenNGC even carries the catalog.** Do not assume it does. Download the CSV and grep its `Identifiers` column:

```bash
curl -s "https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/NGC.csv" -o /tmp/ngc.csv
grep -o "XXX *[0-9]*" /tmp/ngc.csv | sort -u | head     # does the token appear at all?
```

LBN and vdB *are* listed in OpenNGC Identifiers. **Barnard is not — there are zero Barnard/`B NNN` tokens in the entire file**, so the Identifiers approach merges nothing for it. Knowing this up front saves you from shipping dead regex code.

**Mechanism A — OpenNGC Identifiers extraction** (use only if the grep above finds the token). Inside the OpenNGC loop, mirror the LBN/vdB blocks:

```js
const xxxMatches = [...identifiers.matchAll(/XXX\s+(\d+)/g)];
const xxxIds = xxxMatches.map(m => `XXX${parseInt(m[1])}`);
for (const m of xxxMatches) assignedXxxIds.add(parseInt(m[1]));
// ... then append to the catalogs array: catalogs.push(...xxxIds);
```
Track assigned IDs with a `Set` declared before the loop: `const assignedXxxIds = new Set();`

**Mechanism B — curated alias map** (use when OpenNGC doesn't carry the catalog, like Barnard). Define a small hand-verified map and apply it after the OpenNGC loop, appending the new id onto the existing object's `catalogs[]` (field index 12) and marking it assigned so the standalone step skips it:

```js
const XXX_ALIASES = { XXX33: 'IC434', XXX168: 'IC5146' };   // verified pairs only
// ...after data[] is built from OpenNGC:
const rowById = new Map(data.map(r => [r[0], r]));
for (const e of xxxEntries) {
  const id = `XXX${e.num}`, target = XXX_ALIASES[id] && rowById.get(XXX_ALIASES[id]);
  if (target) { target[12].push(id); assignedXxxIds.add(e.num); }
}
```

> **Do NOT auto-merge by position.** Proximity ≠ identity. A dark nebula sitting 1–5′ from an NGC object is frequently a *different* object (e.g. Barnard 81/Barnard 298 land on the globular clusters NGC 6401/NGC 6528; Barnard 86 "Ink Spot" sits next to the open cluster NGC 6520). Naive nearest-neighbour merging produces wrong aliases and hides famous names.
>
> **Verify every curated pair against SIMBAD** before adding it. Query the object and inspect its identifier list:
> ```bash
> curl -s "https://simbad.u-strasbg.fr/simbad/sim-id?output.format=ASCII&Ident=Barnard+33"
> ```
> Note SIMBAD often treats a Barnard dark nebula as **distinct** from the bright NGC/IC nebula it's silhouetted against (it had no NGC/IC cross-ID for any Barnard object), while it *does* equate many Barnard objects with **LDN** entries. Treat NGC/IC pairs as a deliberate UX choice (de-duplicating iconic targets like the Horsehead/IC434), and confirm the user wants it. When the alias target already carries the popular name (IC434 = "Horsehead Nebula", IC5146 = "Cocoon Nebula"), do **not** also add that name as an override on the now-suppressed standalone id — it would be dead config.

### 3c. Append standalone entries (not already assigned via cross-refs)

Add after the other standalone steps (vdB), before the Large-PN / Abell steps. **The `data` row now has 17 columns** and the order must match the `fields` header exactly (a short row silently misaligns every later column):

```
fields = ['id','ra','dec','type','majAxis','minAxis','pa','mag',
          'nameFr','nameEn','nameEs','nameDe','catalogs',
          'emissionLines','constellation','rating','difficulty']
```

```js
// ── Step N: Standalone XXX entries ──────────────────────────────────────────
let xxxAdded = 0;
for (const entry of xxxEntries) {
  if (assignedXxxIds.has(entry.id)) continue;
  const { ra, dec } = precess1950to2000(entry.ra50, entry.dec50); // or galacticToEquatorial, or read J2000 directly
  if (dec < -35) continue;          // southern cut-off (same as rest of catalog)
  const xxxId = `XXX${entry.id}`;
  const majAxis = entry.diam != null ? Math.min(entry.diam, 300) : null; // cap huge hit areas
  data.push([
    xxxId,                          // 0  id
    Math.round(ra * 1000) / 1000,   // 1  ra
    Math.round(dec * 1000) / 1000,  // 2  dec
    'DN',                           // 3  type (EN/RN/DN/PN/... for this catalog)
    majAxis,                        // 4  majAxis (arcmin)
    null,                           // 5  minAxis
    0,                              // 6  pa
    entry.mag ?? null,              // 7  mag (if the catalog has it)
    null,                           // 8  nameFr
    null,                           // 9  nameEn
    null,                           // 10 nameEs
    null,                           // 11 nameDe
    [xxxId],                        // 12 catalogs
    null,                           // 13 emissionLines
    null,                           // 14 constellation
    null,                           // 15 rating
    null,                           // 16 difficulty
  ]);
  xxxAdded++;
}
console.log(`Added ${xxxAdded} standalone XXX entries`);
```

> **Names are NOT set here.** The old `FRENCH_NAMES`/`ENGLISH_NAMES` maps no longer exist. Push `null` for all four name fields; names (and `constellation`/`rating`/`difficulty`) come from `scripts/dso-metadata-overrides.json`, applied by `applyMetadataOverrides()` at the end of generation (matched by primary `id`). See "Custom DSO metadata" above. So for an object merged as an alias (Mechanism B), its standalone id no longer exists — don't add an override for it.

**Finding multilingual common names:** There is no official multilingual naming API — SIMBAD only stores English names. Only add names you can verify from an authoritative source (SIMBAD name list, printed star atlases). If no sourced name exists for a language, leave that field absent rather than translating from English.

### 3d. Priority — update `catalogSortKey()` in `src/dso-catalog.ts`

When an object has several catalog ids, the displayed primary is chosen by `catalogSortKey()` (lower number = higher priority). Current order:
`M(0) > NGC(1) > IC(2) > SH2(3) > LBN(4) > LDN(5) > vdB(6) > Abell(7) > LPN(8) > Barnard(9) > default(10)`

Add your prefix and bump the trailing `return` default:

```typescript
if (id.startsWith('Abell'))   return 7;
if (id.startsWith('LPN'))     return 8;
if (id.startsWith('Barnard')) return 9;
if (id.startsWith('XXX'))     return 10;   // ← new
return 11;                                 // ← bump default
```

Where to slot the new catalog matters: a catalog that only ever appears as an *alias* on a brighter object (Barnard on IC434) belongs **last** so the bright id stays primary. But if your catalog is the *more canonical* designation for an object it shares with a lower-priority catalog (e.g. Barnard vs LDN for the same dark nebula — "Barnard 72 / Snake Nebula" should win over "LDN 66"), give it a *higher* priority than that catalog so the famous name is shown. Decide deliberately.

---

## Step 4 — Regenerate `dso.json`

```bash
node scripts/generate-dso.mjs
```

Check the output:
- Console counts: `Parsed N entries`, `Added N standalone entries`, and (if Mechanism B) `Merged N aliases`. **Reconcile the numbers** — `parsed − standalone` should equal `merged + southern-cutoff skips`, not be silently assumed to be merges.
- File size change in `public/data/dso.json`
- Spot-check a standalone object:
  ```bash
  node -e "
  const d = JSON.parse(require('fs').readFileSync('public/data/dso.json'));
  const f = d.fields, I = x => f.indexOf(x);
  const o = d.data.find(r => r[I('id')] === 'XXX123');
  console.log(o ? [o[I('ra')], o[I('dec')], o[I('type')], o[I('majAxis')], o[I('nameEn')]] : 'NOT FOUND');
  "
  ```
- If you used a curated alias map, verify the **merge** (alias appended to the target, no standalone duplicate, search resolves):
  ```bash
  node -e "
  const d = JSON.parse(require('fs').readFileSync('public/data/dso.json'));
  const f = d.fields, I = x => f.indexOf(x);
  const t = d.data.find(r => r[I('id')] === 'IC434');
  console.log('target catalogs:', t[I('catalogs')]);                              // should include XXX33
  console.log('standalone gone:', !d.data.find(r => r[I('id')] === 'XXX33'));     // should be true
  "
  ```

Then run `npm test` (the `dso-catalog.test.ts` change + hook) and `npm run build` to confirm types and the full suite are green before finishing.

---

## Step 5 — Update `src/dso-catalog.ts` (type, `getDSOCatalog`, `DSO_CATALOGS_ALL`)

All three live in this file. Add `'XXX'` to the type union and the master list, and a branch to the resolver (and don't forget `catalogSortKey()` from Step 3d):

```typescript
export type DSOCatalog = 'M' | 'NGC' | 'IC' | 'SH2' | 'LBN' | 'LDN' | 'vdB' | 'Abell' | 'LPN' | 'Barnard' | 'XXX';

export const DSO_CATALOGS_ALL: DSOCatalog[] = ['M','NGC','IC','SH2','LBN','LDN','vdB','Abell','LPN','Barnard','XXX'];

export function getDSOCatalog(id: string): DSOCatalog | null {
  if (/^M\d/.test(id)) return 'M';
  // ...existing branches...
  if (id.startsWith('Barnard')) return 'Barnard';
  if (id.startsWith('XXX')) return 'XXX';   // ← add
  return null;
}
```

> **Prefix order matters**: if any prefix is a substring-prefix of another, check the more specific one first. (`vdB` precedes a hypothetical `vdBH`.) Single-letter prefixes are forbidden — see Step 6b.

---

## Step 6 — Default-on set (`src/display-settings.ts`)

`DSO_CATALOGS_DEFAULT_ON` controls which catalogs are checked at startup. **New catalogs are off by default** (LBN, LDN, vdB, Abell, LPN, Barnard all are) — usually leave this file untouched:

```typescript
export const DSO_CATALOGS_DEFAULT_ON = new Set(['M', 'NGC', 'IC', 'SH2']);
```

No checkbox wiring is needed — the Display panel iterates `DSO_CATALOGS_ALL` and pulls each label from `t('dso.catalogLabels.XXX')`.

---

## Step 6b — Update the DSO label formatter in `src/sky-map.ts`

Find the label line (search for `replace('LBN'`) and add an **anchored** spacing rule:

```typescript
const label = isMess ? dso.id
  : dso.id.startsWith('LPN-') ? (dso.displayName || dso.id.replace(/^LPN-/, ''))
  : dso.id.replace('NGC', 'NGC ').replace(/^IC(\d)/, 'IC $1')
         .replace('LBN', 'LBN ').replace('LDN', 'LDN ').replace('SH2-', 'Sh2-')
         .replace('vdB', 'vdB ').replace(/^(Abell)(\d)/, '$1 $2')
         .replace(/^(Barnard)(\d)/, '$1 $2')
         .replace(/^(XXX)(\d)/, '$1 $2');   // ← add, anchored to start
```

> **Use an anchored `/^PREFIX(\d)/` regex, NOT a bare `.replace('XXX', 'XXX ')`.** A bare replace rewrites the first match *anywhere* in the string — e.g. `.replace('B', 'B ')` would turn `LBN123` into `LB N123`. This is exactly why single-letter prefixes are banned and why `Abell`/`Barnard` use the anchored form.

---

## Step 7 — Add i18n labels (all FOUR languages)

Add the `XXX` key to the `dso.catalogLabels` object in **`fr.ts`, `en.ts`, `es.ts`, and `de.ts`**. A missing key renders a blank checkbox label. Example (Barnard):

```typescript
// src/i18n/fr.ts
XXX: 'Barnard (nébuleuses sombres)',
// src/i18n/en.ts
XXX: "Barnard's Dark Nebulae",
// src/i18n/es.ts
XXX: 'Barnard (nebulosas oscuras)',
// src/i18n/de.ts
XXX: 'Barnard (Dunkelnebel)',
```

---

## Step 7b — Update `tests/unit/dso-catalog.test.ts`

Add a row to the parametrized `getDSOCatalog()` table (cover any id quirks too, e.g. a letter suffix like `Barnard67a`):

```typescript
it.each([
  // ...existing rows...
  ['XXX123', 'XXX'],
])('getDSOCatalog(%s) === %s', (id, expected) => {
  expect(getDSOCatalog(id)).toBe(expected);
});
```

---

## Step 8 — Update `src/sky-map.ts` default set (optional)

`visibleDSOCatalogs` defaults to `new Set(['M', 'NGC', 'IC', 'SH2'])`. This controls what is rendered at startup. If the new catalog should be **visible by default**, add it here (and to `DSO_CATALOGS_DEFAULT_ON` in Step 6). Otherwise leave both unchanged — the checkbox starts unchecked and rendering skips it.

---

## Step 9 — Verify in the browser

1. Start the dev server: `npm run dev`
2. Navigate to `http://localhost:5173`
3. In the Display panel, find the DSO catalog checkboxes. The new `XXX` checkbox should appear.
4. Check it — DSOs from the new catalog should appear on the map.
5. Hover over one — tooltip should show `XXX 123` as the canvas label and `XXX123` as the ID in the tooltip.
6. Search for e.g. `XXX 45` — it should appear in results.
7. Check browser console for errors.

---

## Step 10 — Validate against SIMBAD

After regenerating `dso.json`, cross-check new entries against SIMBAD (the authoritative source for coordinates and cross-IDs):

```bash
# If you added SH2 objects:
node scripts/validate-simbad.mjs --scope sh2 --deg 1.0 --out scripts/report-sh2.json

# If you added named objects (nameEn set):
node scripts/validate-simbad.mjs --scope named --deg 0.5 --out scripts/report-named.json

# For LBN objects:
node scripts/validate-simbad.mjs --scope lbn --deg 1.0 --out scripts/report-lbn.json
```

The script checks:
- **coord_drift** — our RA/Dec vs SIMBAD's (flags anything > threshold degrees)
- **name_mismatch** — distinctive part of `nameEn` not found in SIMBAD's alias list
- **name_wrong_object** — proper name resolves in SIMBAD to a *different* object (naming confusion)
- **not_found** — SIMBAD doesn't recognise the identifier (possible normalisation issue)

For any `coord_drift` finding above ~1°: update the coordinates to SIMBAD's values, then rerun `node scripts/add-constellations.mjs`.

---

## Known data quality issues in existing catalogs

These are systematic errors that were found and fixed in `dso.json`. Be aware of them when adding or modifying objects in these catalogs.

### SH2 (Sharpless) — systematic coordinate drift

OpenNGC's SH2 coordinates are **wrong for ~96 out of 259 objects** (errors of 2–41°). All have been corrected from SIMBAD. When touching any SH2 object:

- **Never trust OpenNGC RA/Dec for SH2 objects without SIMBAD verification.**
- Query SIMBAD as `Sh2-NNN` (hyphen, mixed case). `Sh2 NNN` (space) returns NOT FOUND.
- Worst-affected regions: SH2-1 to SH2-49 (Galactic centre), SH2-171 to SH2-220 (Perseus/Cassiopeia), SH2-238/239/245 (Taurus/Orion fringe).

### Barnard (dark objects) — not in OpenNGC, distinct from IC/NGC in SIMBAD

- OpenNGC's `Identifiers` column contains **no** Barnard references, so cross-refs are handled by the curated `BARNARD_ALIASES` map in `generate-dso.mjs` (currently `Barnard33→IC434`, `Barnard168→IC5146`), not by Identifiers scanning.
- SIMBAD treats every Barnard dark nebula as a **distinct object** from the bright IC/NGC nebula it is silhouetted against (no NGC/IC cross-ID for any Barnard object), but **does** equate many Barnard objects with **LDN** entries (e.g. B86=LDN93, B92=LDN323). So Barnard↔IC/NGC merges are a deliberate de-duplication choice; Barnard↔LDN would be true identity (not yet merged).
- Source `VII/220A` provides J2000 directly (bytes 23–44); ids use the spelled-out `Barnard` prefix. A few ids carry a letter suffix (`67a`, `83a`, `117a`).

### Abell planetary nebulae (LPN-AbellN)

SIMBAD resolves plain "Abell N" to **galaxy clusters** (ACO N), not planetary nebulae. Always use the PN G identifier (stored in the `catalogs` array, e.g. `PN G318.4+41.4`) to verify in SIMBAD. The validation script already handles this (`PN A66 N` query format). All LPN-Abell* coordinates have been verified correct.

### Naming confusions already fixed

| ID | Problem | Resolution |
|---|---|---|
| SH2-147 | Named "Simeis 147 Nebula" — wrong; Simeis 147 is Sh2-240 in Taurus | Names cleared |
| SH2-240 | Wrong coords (RA 97°, Gem) + wrong name ("Pencil Nebula") | Corrected: RA=85.275°, Dec=28.083° (Tau); name → "Spaghetti Nebula"; aliases: LBN822, Simeis 147 |
| IC443 | No name | Added: "Jellyfish Nebula" / "Nébuleuse de la Méduse" |

### French proper name collisions

"Méduse" means both "jellyfish" and "Medusa" in French — no linguistic workaround:
- IC443 (Jellyfish Nebula, SNR) → `nameFr: "Nébuleuse de la Méduse"`
- SH2-274 / Abell 21 (Medusa Nebula, PN) → `nameFr: "Nébuleuse de la Méduse"` (identical — accepted)

When adding new objects, check whether the French name collides with an existing one. SIMBAD Phase-2 name resolution in the validation script catches cross-object name conflicts.

---

## Common pitfalls

- **Coordinate system — verify per catalog, don't guess by age**: Read the ReadMe. Four cases: J2000 already present (no conversion — **check first**), B1950 (`precess1950to2000()`), galactic l/b (`galacticToEquatorial()`), or other. "Old catalog" tells you nothing: Barnard (1875/1927) is **equatorial with a precomputed J2000 column**, not galactic; vdB is galactic; LBN/LDN are B1950. The earlier version of this skill wrongly listed Barnard as galactic — don't trust memory, read the bytes.
- **1-indexed ReadMe vs 0-indexed substring**: VizieR byte ranges are 1-indexed inclusive; `line.substring(start-1, end)`. Off-by-one here silently shifts every field.
- **VizieR access**: HTTPS website/ReadMe/dir-listing is Anubis-walled (`WebFetch`/browser get "Access Denied"). But the build script's `fetch()` to the HTTPS `/ftp/.../*.dat` data file works, and `curl ftp://cdsarc.cds.unistra.fr/cats/...` (FTP protocol) works for ReadMe/listings. See Step 1.
- **Assuming OpenNGC carries your catalog**: It carries LBN and vdB but **not** Barnard (zero tokens). `grep` the CSV before writing Identifiers-regex code, or it's dead code. Use a curated alias map instead (Step 3b, Mechanism B).
- **Proximity ≠ identity**: Never auto-merge a new object onto its nearest existing object. Dark nebulae routinely sit next to unrelated clusters (Barnard 81→NGC 6401 globular, Barnard 86→NGC 6520 open cluster). Verify each curated pair in SIMBAD.
- **Row field count**: A `data.push([...])` must have **17 elements** matching the `fields` header. A short row misaligns `catalogs`/`constellation`/`rating`/etc. for that object with no error.
- **Names aren't set in `generate-dso.mjs`**: `FRENCH_NAMES`/`ENGLISH_NAMES` are gone. Push `null`; add names to `scripts/dso-metadata-overrides.json` (4 languages). Don't add an override for an id that was merged away as an alias.
- **`catalogSortKey()` forgotten**: If you add the prefix to `getDSOCatalog()` but not `catalogSortKey()`, merged objects may pick the wrong primary id for display.
- **Southern cut-off**: `dec < -35` objects are skipped (northern polar projection). A purely-southern catalog adds nothing visible.
- **Label formatting — anchored regex only**: Use `.replace(/^(XXX)(\d)/, '$1 $2')`. A bare `.replace('B', 'B ')` corrupts substrings (`LBN` → `LB N`). Single-letter prefixes are banned for this reason.
- **`getDSOCatalog` returning null**: An unregistered prefix makes those objects ignore the visibility checkbox (treated as unfiltered). Always register in both the `DSOCatalog` type and `getDSOCatalog()`.
- **i18n key missing in any of 4 files**: A blank label means `fr/en/es/de` `catalogLabels.XXX` is missing somewhere.
- **Size capping**: Cap `majAxis` for catalogs with huge objects: `Math.min(diam, 300)` — avoids absurd hit areas.
