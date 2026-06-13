# DSO Catalog

## Data Quality & Validation

### Authoritative source: SIMBAD

**SIMBAD (CDS Strasbourg)** is the ground truth for object identity, coordinates, and cross-catalog references. When any field in `dso.json` conflicts with SIMBAD, trust SIMBAD. OpenNGC is the primary upstream source but has known systematic errors, especially in the Sharpless (SH2) catalog.

### Validation tool

`scripts/validate-simbad.mjs` cross-checks `dso.json` against SIMBAD via its TAP/ADQL API:

```bash
# Check all named objects (fastest, highest-value — ~184 objects)
node scripts/validate-simbad.mjs --scope named --deg 0.5 --out scripts/report-named.json

# Check all Sharpless objects (259 objects, ~2.5 min)
node scripts/validate-simbad.mjs --scope sh2 --deg 1.0 --out scripts/report-sh2.json

# Check LBN objects (873 objects, ~7 min)
node scripts/validate-simbad.mjs --scope lbn --deg 1.0 --out scripts/report-lbn.json
```

Checks performed:
- **coord_drift** — angular separation between our RA/Dec and SIMBAD's (flags > threshold)
- **name_mismatch** — our `nameEn` distinctive core word not found in SIMBAD's aliases for that object
- **name_wrong_object** — Phase 2: proper name resolves in SIMBAD to a *different* object than our ID
- **not_found** — SIMBAD doesn't recognise the identifier at all (may indicate a normalisation issue)

After fixing coordinates, always recompute constellations:
```bash
node scripts/add-constellations.mjs
```

### Known OpenNGC issues (fixed in dso.json)

| Object | Issue | Fix applied |
|---|---|---|
| **SH2-147** | Was wrongly named "Simeis 147 Nebula" — that name belongs to Sh2-240 in Taurus | Cleared nameEn/nameFr |
| **SH2-240** | Wrong coordinates (RA 97°, Gem) and wrong name ("Pencil Nebula") | Corrected to SIMBAD coords RA=85.275°, Dec=28.083° (Tau); renamed Spaghetti Nebula; added "Simeis 147" & "LBN822" as catalog aliases |
| **SH2-1 … SH2-49** | Systematic OpenNGC coordinate errors up to 22° in the Galactic-centre SH2 region | All 96 coord_drift objects updated from SIMBAD |
| **SH2-171 … SH2-220** | Systematic drift (3–15°) in the Perseus/Cassiopeia SH2 region | Included in the 96-object batch fix |
| **SH2-238, SH2-239, SH2-245** | Large drifts (26–41°) in the Taurus/Orion fringe | Included in batch fix |
| **IC443** | Missing name | Added: nameEn "Jellyfish Nebula", nameFr "Nébuleuse de la Méduse" |
| **LPN-Abell*** (PNe) | SIMBAD resolves "Abell N" to galaxy clusters (ACO N); script now uses "PN A66 N" | Coordinates verified correct via PN G identifiers |

### SIMBAD identifier normalisation (for the validation script)

| Our format | SIMBAD query format |
|---|---|
| `SH2-240` | `Sh2-240` (hyphen, not space) |
| `LBN873` | `LBN 873` |
| `NGC7009` | `NGC 7009` |
| `IC1805` | `IC 1805` |
| `M31` | `M 31` |
| `LPN-Abell36` | `PN A66 36` (avoids galaxy cluster ACO 36) |
| `vdB107` | `vdB 107` |

### Rules when adding new catalog objects

1. **Before adding**: query SIMBAD by identifier to confirm coordinates and proper name.
2. **Proper names**: verify the English name isn't already used for a different object (e.g., two objects both called "Méduse" in French). SIMBAD Phase-2 check in the script catches this.
3. **SH2 objects**: treat all OpenNGC SH2 coordinates as suspect until verified against SIMBAD — the systematic drift pattern is real.
4. **Abell planetary nebulae**: use PN G identifiers (in the `catalogs` array) to unambiguously verify coordinates. Do not use "Abell N" queries in SIMBAD (hits galaxy clusters).
5. **After any coordinate edit**: run `node scripts/add-constellations.mjs` to recompute the `constellation` field.

---

## Rating and Difficulty Fields

`public/data/dso.json` is a columnar JSON with 15 fields. The `rating` (1–5 photographic interest) and `difficulty` (1–5 imaging effort) fields are computed by `scripts/add-ratings.mjs` and baked into the file. **To regenerate after changing the script:**

```bash
# Strip existing rating/difficulty columns, then re-add
node -e "
const fs = require('fs'), path = 'public/data/dso.json';
const d = JSON.parse(fs.readFileSync(path,'utf8'));
const toRemove = ['rating','difficulty'].map(f=>d.fields.indexOf(f)).filter(i=>i>=0).sort((a,b)=>b-a);
d.fields = d.fields.filter(f=>f!=='rating'&&f!=='difficulty');
d.data = d.data.map(r=>{const a=[...r];toRemove.forEach(i=>a.splice(i,1));return a;});
fs.writeFileSync(path,JSON.stringify(d));
"
node scripts/add-ratings.mjs
```

### Rating (photographic interest 1–5)

Blended from three sources (weights in parentheses):
- **Source A** — *The 750 Best DSOs* PDF data (`scripts/data-750-best-dsos.json`) — curated imaging scores (weight 3)
- **Source B** — Astrogenerator SQLite DB (`/home/gweybrec/workspace/other/astrogenerator/dbastrogenerator`) — `interet` field 1–4 mapped to 1–5 (weight 2)
- **Heuristic fallback** — Messier objects get a floor of 3; objects in both A+B use a weighted blend

### Difficulty (imaging effort 1–5)

Computed by `computeDifficulty()` in `scripts/add-ratings.mjs`. The scale is intended to reflect practical imaging effort — i.e. how quickly a target shows up in integration and how much total time is needed for a good result:

| Difficulty | Meaning |
|---|---|
| 1 | Trivially easy — shows up in seconds (open clusters, globulars, bright nebulae, very bright galaxies) |
| 2 | Easy — visible in < 1 hour, beginner-friendly |
| 3 | Moderate — needs 2–4 hours, some technique |
| 4 | Hard — needs many hours, dark skies, good tracking |
| 5 | Expert — LSB objects, huge mosaics, requires many nights |

**Galaxy difficulty** uses OpenNGC mean surface brightness (SB, mag/arcsec²) as the primary metric, with two corrections:

1. **Magnitude cap** — mean SB is diluted for large or edge-on galaxies (e.g. a bright galaxy spread over a large area has lower mean SB but is still easy to image). Cap: `ceil((mag − 7) / 2)`, so mag ≤ 9 → cap 1, mag ≤ 11 → cap 2, mag ≤ 13 → cap 3.  
   Fallback when no SB data: astrogenerator `difficulte` field (1–4), then default 3.

2. **Messier cap** — all Messier objects are capped at difficulty 2. The Messier catalog is by definition a list of beginner-accessible targets; any Messier object will show up in < 1 hour of integration.

SB thresholds (after applying the magnitude cap):

| Surface brightness | Raw difficulty |
|---|---|
| ≤ 21.0 | 1 |
| ≤ 22.5 | 2 |
| ≤ 23.5 | 3 |
| ≤ 24.5 | 4 |
| > 24.5 | 5 |

**Non-galaxy difficulty** uses astrogenerator `difficulte` (1–4) as the base, with adjustments:
- Size > 300' → 5 (impossible to image as a single frame)
- Size > 120' → +1 (low surface brightness from sheer extent)
- Type RN or DN → +1 (reflection/dark nebulae are harder)
- Has emission lines → −1 (narrowband filters make it easier)
- Messier cap at 2 applies here as well

**Key design decision:** difficulty reflects how quickly a target *appears* in an image, not how impressive the final result can be. A galaxy that needs 5 hours to show fine spiral structure but appears in 20 minutes is still difficulty 2.

---

## DSO Metadata Overrides

`scripts/dso-metadata-overrides.json` is an array of 12,000+ entries that augment or correct the raw data produced by the source catalogs (OpenNGC, SH2, LBN, LDN, vdB). It is consumed by `scripts/generate-dso.mjs` during catalog generation via `applyMetadataOverrides()`.

### Override entry fields

| Field | Type | Purpose |
|---|---|---|
| `id` | string | Primary DSO identifier (e.g. `"M31"`, `"NGC6523"`, `"SH2-101"`) |
| `catalogs` | string[] | All known aliases — used to resolve lookups by secondary IDs |
| `constellation` | string \| null | Override the constellation assignment |
| `rating` | number \| null | Override the photographic interest score (1–5) |
| `difficulty` | number \| null | Override the imaging difficulty score (1–5) |
| `names.fr` | string | French common name |
| `names.en` | string | English common name |
| `names.es` | string | Spanish common name |
| `names.de` | string | German common name |
| `type` | string | Override the DSO type code (e.g. `"EN"`, `"RN"`, `"SNR"`) when OpenNGC records it as `"?"` or generic `"Neb"` |
| `ra` | number | Override right ascension (degrees) — used for SIMBAD-corrected coordinates |
| `dec` | number | Override declination (degrees) |

All fields except `id` and `catalogs` are optional. `applyMetadataOverrides()` only writes non-null values, so omitting a field leaves the source-catalog value intact.

### How to update default metadata overrides

1. Edit `scripts/dso-metadata-overrides.json` — find the entry by `id` (or add a new one if none exists for that object).
2. Set any field you want to correct or add (`names.fr`, `ra`, `type`, `rating`, …). Leave fields you don't want to touch absent or `null`.
3. Rebuild the catalog:
   ```bash
   npm run dso:generate
   ```
   This runs `generate-dso.mjs` (rebuilds `public/data/dso.json`) followed by `add-constellations.mjs` (recomputes the `constellation` field, which is needed whenever coordinates change).
4. **If you changed coordinates**, verify the result against SIMBAD using the validation script (see [Validation tool](#validation-tool) above).

### Migration scripts

Two one-shot scripts were used to populate the file from previously hardcoded data. They are idempotent and safe to re-run (e.g. if the file is regenerated from scratch):

- **`scripts/migrate-names-to-overrides.mjs`** — moved the `FRENCH_NAMES`, `ENGLISH_NAMES`, `SPANISH_NAMES`, `GERMAN_NAMES`, and SH2 name dicts out of `generate-dso.mjs` and into the overrides file.
- **`scripts/migrate-type-overrides.mjs`** — moved the `TYPE_OVERRIDE` dict (correcting nebula types that OpenNGC records as `"?"`) into the overrides file.

### Why SH2_DATA stays in generate-dso.mjs

`SH2_DATA` is a *primary source catalog*, not an override. It defines the existence of Sharpless H-II region objects that do not appear in any downloadable machine-readable catalog used by the pipeline. `dso-metadata-overrides.json` can only override fields on objects that already exist — it cannot create new objects. SH2 object names and coordinates come from Sharpless 1959 (ApJS 4, 257) with SIMBAD corrections applied via `scripts/fix-sh2-coords.mjs`.

---

## Runtime User Overrides

In addition to the build-time overrides above, the app supports per-user DSO metadata edits at runtime. These are stored separately from `dso.json` and `dso-metadata-overrides.json`.

- **Storage**: SQLite table `dso_overrides` (id TEXT PRIMARY KEY, data TEXT) in the server's `data.db`. All fields from `DSOUserOverride` are supported: `names`, `ra`, `dec`, `constellation`, `rating`, `difficulty`, `type`.
- **API**: `GET /api/dso-overrides` (all), `PUT /api/dso-overrides/:id` (upsert), `DELETE /api/dso-overrides/:id`.
- **Frontend**: Loaded on startup by `dso-catalog.ts` and applied as an in-memory overlay on top of catalog data. The DSO editor modal (`dso-editor.ts`) is accessible from the sky-map DSO info panel and from each target card in the Targets view.
- **Export/Import**: Runtime overrides can be included in the export ZIP as `dso-overrides.json` (opt-in checkbox). Import respects a "Skip DSO metadata overrides" checkbox to prevent clobbering local edits.
