---
name: add-dso-catalog
description: >
  Add a new external DSO catalog (e.g. RCW, Barnard, vdBH, Abell) to the sky map.
  Use when asked to integrate a new catalog, wire it into generate-dso.mjs, add its
  prefix to dso-catalog.ts and ui.ts, add i18n labels, and validate against SIMBAD.
  Trigger phrases: "add catalog", "new catalog", "integrate catalog", "wire catalog",
  "add DSO catalog", "new object catalog".
---

# Add a New DSO Catalog

This skill guides you through integrating a new external DSO catalog (e.g. RCW, Barnard, van den Bergh-Hagen, Abell, etc.) into the sky map. It follows the exact same pattern used to add LBN and LDN.

## Unit Test Plan (mandatory, part of the plan)

Before writing any code, the plan must explicitly address unit tests:

- **List every test file to create or update**, with a brief description of what each test covers.
- New catalog parse functions (`parseXXX`) and coordinate conversion paths used for the first time are pure functions — they must be tested with representative sample rows from the catalog source.
- Reusing an existing coordinate helper (`precess1950to2000`, `galacticToEquatorial`) that already has coverage does not require new tests for the helper itself, but the plan must confirm the existing tests cover the conversion path being used.
- If no unit test changes are needed, the plan must **state the justification** (e.g. "parse function is a trivial split with no branching; coordinate path is identical to the already-tested LDN path").
- Identifying tests is part of the plan, not an afterthought. A plan that omits this section is incomplete.

Tests live in `tests/unit/`. Run with `npm test`.

---

## Overview of touched files

1. `scripts/generate-dso.mjs` — download, parse, merge, and output to `dso.json`
2. `public/data/dso.json` — regenerated artifact (run the script)
3. `src/dso-catalog.ts` — `getDSOCatalog()` needs the new prefix
4. `src/sky-map.ts` — label formatting `.replace()` chain for the new prefix
5. `src/ui.ts` — `DSO_CATALOGS_ALL` and `DSO_CATALOGS_DEFAULT_ON`
6. `src/i18n/fr.ts` and `src/i18n/en.ts` — label key for the new catalog

`src/sky-map.ts` `visibleDSOCatalogs` default set only needs updating if the catalog should be **on at startup**.

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

| Question | Example (LBN) | Example (LDN) |
|---|---|---|
| Short prefix (used as catalog key) | `LBN` | `LDN` | `vdB` |
| Full name | Lynds Bright Nebulae | Lynds Dark Nebulae | van den Bergh |
| DSO type code used in render | `EN` or `RN` | `DN` | `RN` |
| Source URL (VizieR FTP or HTTP) | `https://cdsarc.cds.unistra.fr/ftp/VII/9/catalog.dat` | `https://cdsarc.cds.unistra.fr/ftp/VII/7A/ldn` | `https://cdsarc.cds.unistra.fr/ftp/VII/21/catalog.dat` |
| Epoch / coordinate system | B1950 RA/Dec | B1950 RA/Dec | Galactic l,b (IAU 1958) |
| On by default in UI? | No | No | No |
| Cross-refs in OpenNGC `Identifiers` column? | Yes (`LBN NNN`) | No | No |

Use VizieR (https://vizier.cds.unistra.fr) to find the catalog's FTP URL and column layout.

> **VizieR bot protection**: As of 2026, the VizieR *website* (ReadMe pages, search UI) is protected by the Anubis CAPTCHA and cannot be fetched automatically. However, the **FTP data files** at `cdsarc.cds.unistra.fr/ftp/...` are still accessible directly without any challenge. Always use the FTP path for `fetch()`. To read the ReadMe for column offsets, use the `viz-bin/ReadMe/` URL (which may still work as a fetch target) or look it up manually in a browser first.

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

**Coordinate conversion**: Three cases exist:
- **B1950 RA/Dec** (e.g. LBN, LDN): use the existing `precess1950to2000(ra50, dec50)` helper → `{ ra, dec }` in J2000 degrees.
- **Galactic (l, b)** (e.g. vdB, VII/21): use the `galacticToEquatorial(l_deg, b_deg)` helper → `{ ra, dec }` in J2000 degrees. This function was added to `generate-dso.mjs` when implementing vdB and is available for reuse.
- **J2000 RA/Dec**: no conversion needed.

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

### 3b. Handle cross-refs from OpenNGC (if they exist)

If OpenNGC's `Identifiers` column contains references like `XXX NNN`, add extraction inside the OpenNGC processing loop (Step 4 of the existing script):

```js
const xxxMatches = [...identifiers.matchAll(/XXX\s+(\d+)/g)];
const xxxIds = xxxMatches.map(m => `XXX${parseInt(m[1])}`);
for (const m of xxxMatches) assignedXxxIds.add(parseInt(m[1]));
// ... then append xxxIds to the catalogs array
catalogs.push(...xxxIds);
```

Track assigned IDs with a `Set` declared before the loop: `const assignedXxxIds = new Set();`

### 3c. Append standalone entries (not already assigned via cross-refs)

Add as the **last step before the sort**, after the LDN step (current Step 7). New catalogs become Step 8, 9, etc.:

```js
// ── Step N: Standalone XXX entries ──────────────────────────────────────────
let xxxAdded = 0;
for (const entry of xxxEntries) {
  if (assignedXxxIds.has(entry.id)) continue;
  const { ra, dec } = precess1950to2000(entry.ra50, entry.dec50); // or galacticToEquatorial
  if (dec < -35) continue;          // southern cut-off (same as rest of catalog)
  const xxxId = `XXX${entry.id}`;
  const nameFr = FRENCH_NAMES[xxxId] || null;
  const nameEn = ENGLISH_NAMES[xxxId] || null;
  data.push([
    xxxId,
    Math.round(ra * 1000) / 1000,
    Math.round(dec * 1000) / 1000,
    'EN',                            // or DN / RN etc. for this catalog
    entry.diam || null,
    null,
    0,
    entry.mag || null,               // include magnitude if the catalog has it
    nameFr,
    nameEn,
    [xxxId],
  ]);
  xxxAdded++;
}
console.log(`Added ${xxxAdded} standalone XXX entries`);
```

Always look up `FRENCH_NAMES` and `ENGLISH_NAMES` for notable objects so they get proper names in tooltips. Also cap `majAxis` for catalogs that include very large objects (e.g. `Math.min(entry.radius * 2, 300)`) to avoid absurdly large hit areas on the map.

**Finding multilingual common names:** There is no official multilingual naming API — SIMBAD only stores English names. Only add names you can verify from an authoritative source (SIMBAD name list, printed star atlases). If no sourced name exists for a language, leave that field absent rather than translating from English.

### 3d. Priority of `catalogs` array

The first element of the `catalogs` array becomes `dso.id`. Priority order in the codebase is:
`M > NGC > IC > SH2 > LBN > LDN > ...new catalog`

For a new catalog that is never the primary identifier (i.e. only appears as an alias on an NGC/IC/SH2/LBN object), it will always be appended at the end of the `catalogs` array. For a new catalog where the object has **no** other identifier, it becomes the sole element.

---

## Step 4 — Regenerate `dso.json`

```bash
node scripts/generate-dso.mjs
```

Check the output:
- Count of parsed and added entries (printed to console)
- File size change in `public/data/dso.json`
- Spot-check a known object in the terminal:
  ```bash
  node -e "
  const d = JSON.parse(require('fs').readFileSync('public/data/dso.json'));
  const f = d.fields; const idI = f.indexOf('id'), raI = f.indexOf('ra'), decI = f.indexOf('dec'), majI = f.indexOf('majAxis'), enI = f.indexOf('nameEn');
  const obj = d.data.find(r => r[idI] === 'XXX123');
  console.log(obj ? [obj[raI], obj[decI], obj[majI], obj[enI]] : 'NOT FOUND');
  "
  ```

---

## Step 5 — Add the prefix to `getDSOCatalog()` in `src/dso-catalog.ts`

```typescript
export function getDSOCatalog(id: string): DSOCatalog | null {
  if (/^M\d/.test(id)) return 'M';
  if (id.startsWith('NGC')) return 'NGC';
  if (id.startsWith('IC')) return 'IC';
  if (id.startsWith('SH2')) return 'SH2';
  if (id.startsWith('LBN')) return 'LBN';
  if (id.startsWith('LDN')) return 'LDN';
  if (id.startsWith('vdB')) return 'vdB';
  if (id.startsWith('XXX')) return 'XXX';   // ← add this line
  return null;
}
```

Also add `'XXX'` to the `DSOCatalog` type:

```typescript
export type DSOCatalog = 'M' | 'NGC' | 'IC' | 'SH2' | 'LBN' | 'LDN' | 'vdB' | 'XXX';
```

> **Prefix order matters**: if any catalog prefix is a prefix of another (e.g. a hypothetical `vdBH` and `vdB`), check the more specific one first. All current prefixes are unambiguous.

---

## Step 6 — Update `src/ui.ts`

Two constants at the top of the file (around line 63):

```typescript
const DSO_CATALOGS_ALL = ['M', 'NGC', 'IC', 'SH2', 'LBN', 'LDN', 'vdB', 'XXX'];
// Only add to DEFAULT_ON if this catalog has ≤ ~2000 entries and good average mag.
// LBN, LDN, vdB are off by default; new catalogs should usually also be off by default.
const DSO_CATALOGS_DEFAULT_ON = new Set(['M', 'NGC', 'IC', 'SH2']);
```

No other changes needed — the checkbox loop reads `DSO_CATALOGS_ALL` automatically and pulls the label from `t('dso.catalogLabels.XXX')`.

---

## Step 6b — Update the DSO label formatter in `src/sky-map.ts`

Find the label formatting line (search for `replace('LBN'`) and add the new catalog's spacing rule:

```typescript
const label = isMess ? dso.id
  : dso.id.replace('NGC', 'NGC ').replace(/^IC(\d)/, 'IC $1')
         .replace('LBN', 'LBN ').replace('LDN', 'LDN ').replace('SH2-', 'Sh2-')
         .replace('vdB', 'vdB ').replace('XXX', 'XXX ');  // ← add
```

This inserts a space between the prefix and the number so canvas labels read `"XXX 123"` rather than `"XXX123"`.

---

## Step 7 — Add i18n labels

### `src/i18n/fr.ts`

In the `dso.catalogLabels` object (current state includes vdB):

```typescript
catalogLabels: {
  M: 'Messier',
  NGC: 'NGC',
  IC: 'IC',
  SH2: 'Sharpless',
  LBN: 'Lynds (nébuleuses brillantes)',
  LDN: 'Lynds (nébuleuses sombres)',
  vdB: 'van den Bergh',
  XXX: 'Nom complet FR',   // ← add
},
```

### `src/i18n/en.ts`

```typescript
catalogLabels: {
  M: 'Messier',
  NGC: 'NGC',
  IC: 'IC',
  SH2: 'Sharpless',
  LBN: "Lynds' Bright Nebulae",
  LDN: "Lynds' Dark Nebulae",
  vdB: 'van den Bergh',
  XXX: 'Full English Name',   // ← add
},
```

---

## Step 8 — Update `src/sky-map.ts` default set (optional)

`visibleDSOCatalogs` defaults to `new Set(['M', 'NGC', 'IC', 'SH2'])` (around line 89). This controls what is rendered at startup. If the new catalog should be **visible by default** at startup, add it here. Otherwise leave it unchanged — the UI checkbox will start unchecked and the rendering will skip it.

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

- **Coordinate system**: Check the ReadMe carefully. Three cases: B1950 RA/Dec (use `precess1950to2000()`), galactic l/b (use `galacticToEquatorial()`, implemented for vdB), or J2000 (no conversion). Old catalogs like Barnard, RCW, and vdB are galactic; LBN, LDN are B1950.
- **VizieR bot protection**: The VizieR web UI (ReadMe pages, search) may be blocked by CAPTCHA when fetched programmatically. The raw FTP data files at `cdsarc.cds.unistra.fr/ftp/...` work fine. Use a browser to read the ReadMe for byte offsets, then use FTP URLs in `fetch()`.
- **Southern cut-off**: The map uses a northern polar projection. Objects with `dec < -35` are off the visible map — the script skips them. If your catalog is purely southern, it won't add anything visible.
- **Duplicate IDs**: If two objects end up with the same primary ID in `data`, the later one silently overwrites the former in the `dsoById` map. Check console for unexpected count drops.
- **`assignedXxxIds` not initialized**: Must be declared as `const assignedXxxIds = new Set();` *before* the OpenNGC loop if cross-refs are extracted inside that loop.
- **Label key missing**: If `t('dso.catalogLabels.XXX')` returns undefined, the checkbox label will be blank. Check that both `fr.ts` and `en.ts` have the key.
- **`getDSOCatalog` returning null**: If the prefix isn't registered, catalog filtering will treat all XXX objects as unfiltered and always visible regardless of the checkbox state. Always add the prefix to both `DSOCatalog` type and `getDSOCatalog()`.
- **Label formatting**: If the `.replace()` chain in `sky-map.ts` doesn't include the new prefix, canvas labels will read `"XXX123"` without spacing. Add `.replace('XXX', 'XXX ')` to the chain (Step 6b).
- **Size capping**: Some catalogs include objects with very large angular radii (e.g. vdB 36 at 410'). Cap `majAxis` to avoid absurdly large hit areas: `Math.min(entry.radius * 2, 300)`.
