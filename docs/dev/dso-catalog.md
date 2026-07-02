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

## Rating, Difficulty, Priority, and Containment Fields

`public/data/dso.json` is a columnar JSON. Several fields are derived (not raw catalog data) and baked in by the build scripts:

- `rating` (1–5 photographic interest) and `difficulty` (1–5 imaging effort) — `scripts/add-ratings.mjs`
- `containerId` (zoom-gated inner objects) — `scripts/add-ratings.mjs` (needs `rating`); see [Containment](#containment-containerid) below
- `priority` (render order, spatial spread) — `scripts/add-ratings.mjs` (needs `rating`); see [Render priority](#render-priority-spatial-spread) below

All four derived fields are produced together by `add-ratings.mjs`. **To regenerate:** rebuild the base catalog with `npm run dso:generate`, then strip the four derived columns and re-run the rating script:

```bash
# Strip the derived columns, then re-add (add-ratings.mjs recomputes all four)
node -e "
const fs = require('fs'), path = 'public/data/dso.json';
const d = JSON.parse(fs.readFileSync(path,'utf8'));
const DERIVED = ['rating','difficulty','containerId','priority'];
const toRemove = DERIVED.map(f=>d.fields.indexOf(f)).filter(i=>i>=0).sort((a,b)=>b-a);
d.fields = d.fields.filter(f=>!DERIVED.includes(f));
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

### Render priority (spatial spread)

`priority` is an integer **render order** (lower = drawn first) computed by `computeRenderPriority()` in `scripts/add-ratings.mjs`. It is *precomputed* because it is view-independent: the on-map selection at runtime is simply "take the lowest-`priority` objects currently in the viewport, up to the budget" (see [architecture.md → DSO render selection](/dev/architecture.md#dso-render-selection-priority--spread--container-gating)). Baking the spread in here keeps the runtime selection to a sort + slice, with no per-frame spatial computation.

**Why it matters:** when zoomed out, dense regions (Orion, Sagittarius) used to consume the whole `maxDSOCount` budget while the rest of the sky stayed empty, and low-interest objects (vdB reflection nebulae, etc.) cluttered the view. `priority` fixes both: high-rating objects come first, and they are spread evenly over the sky.

**Algorithm** — a rating-weighted progressive blue-noise (farthest-point) ordering:

1. **Importance** per object = `rating` descending (null → 0), then `mag` ascending. This is what demotes minor objects — vdB and other rating-1/unrated objects rank last.
2. **Equal-area sky coords** `x = RA/360`, `y = (sin(dec)+1)/2`, so grid cells cover equal solid angle (uniform angular spread).
3. **Hierarchical grid tiers** — walking objects in importance order, each object claims the coarsest still-free cell from level 0 (whole sky) down to level `PRIORITY_MAX_LEVEL` (= 13, i.e. 2¹³ cells/axis). The level it lands at is its *spread tier*: the most important object in each coarse region surfaces first, finer detail fills in progressively.
4. **Final `priority`** = sort by `(tier asc, importance asc)`. Any prefix (top-N) is therefore well-distributed over the sky for *any* render budget. O(n·levels), integer cell ops only (~20 ms for 14 k objects).

To re-tune spread density, adjust `PRIORITY_MAX_LEVEL` (finer = denser allowed clustering) and regenerate.

### Containment (`containerId`)

`containerId` links a DSO to the **dominant object of its region** — the larger, *more important* DSO whose ellipse encloses it (or `null`). It powers zoom-gated inner objects on the map: a minor inner object (e.g. the NGC knots and M43 inside the Orion Nebula) is hidden until its container renders large enough on screen, so the container stays clean and clickable when zoomed out (the on-screen size gate lives at runtime in `sky-map.ts`, `DSO_CONTAINER_VISIBLE_RADIUS_PX`).

Computed by `computeContainers()` in `scripts/add-ratings.mjs` — it lives there (not `generate-dso.mjs`) because the dominance test needs `rating`:

- **Container candidates** = objects with `majAxis ≥ LARGE_CONTAINER_ARCMIN` (30′), binned into a coarse RA/Dec grid (`CONTAINER_GRID_DEG` = 5°), each inserted into every cell its bounding circle overlaps.
- For each object, test only the candidates in its cell. A candidate is a valid container only if it is (a) **substantially larger** — `container.majAxis / inner.majAxis ≥ CONTAINER_SIZE_RATIO` (2.5), (b) **strictly more important** — `dsoImportance` (rating, then magnitude) higher than the inner object, and (c) its **ellipse encloses** the inner centre (offset decomposed onto major/minor axes via `pa`). The most important qualifying candidate wins.
- **Why importance, not just size:** an iconic object that merely overlaps a larger *faint* backdrop must not be hidden behind it. The rule keeps M42 visible (it sits inside Barnard's Loop, rating 3 < M42's 5), M17 visible (inside SH2-45, rating 2), and M11 visible (over a dark nebula), while still gating genuine minor inner objects (NGC1973/5/7, M43) behind their dominant parent (M42). It also removes the need for a maximum-size cap: a genuinely important giant (a future LMC-type object) *should* gate its own clutter. No rating-5 object is ever gated.

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
| `majAxis` | number | Override the angular major-axis size (arcmin) — for correcting a wrong/missing diameter |
| `minAxis` | number | Override the angular minor-axis size (arcmin) |
| `pa` | number | Override the position angle (degrees, E of celestial north) — OpenNGC leaves this blank (defaults to 0) for most nebulae; derive a real value from a plate-solved photo when the default orientation is visibly wrong |
| `mag` | number | Override or fill in the apparent magnitude |

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

### SH2 angular sizes — sourced from Sharpless VII/20

The hand-entered `majAxis` values in `SH2_DATA` diverged from the authoritative Sharpless diameters for ~113 of ~313 entries (in *both* directions — some 10× too small, some 10× too big, including default `10′` placeholders). The pipeline now corrects these: in Step 5 it loads **`scripts/sharpless-diam.json`** (`SHARPLESS_DIAM`, the `Diam` column of Vizier `VII/20`) and, when a hand value diverges from Sharpless by **>3×**, substitutes the Sharpless diameter. Values already within 3× are left untouched.

Per-object exceptions are corrected with a **`majAxis`/`minAxis` override** in `dso-metadata-overrides.json` (these fields are now supported by `applyMetadataOverrides`): SH2-312 → 720′×180′, NGC 7822 / SH2-171 region → 180′, IC 1805 / Heart → 150′, NGC 6357 / SH2-11 region → 90′.

> **Caution — `SH2_DATA`'s 5th field is unused and unreliable.** It holds a stray French label that the pipeline does **not** read (display names come from the overrides file). Several are wrong; do not promote one into a real name without verifying. Notably **SH2-147 is *not* Simeis 147** — it is a small (~2′) HII region in Cepheus. Simeis 147 / the Spaghetti Nebula is **SH2-240** (SNR G180.0-01.7), which is named and sized correctly via its own override.

Regenerate `sharpless-diam.json`: `SELECT "Sh2", Diam FROM "VII/20/catalog"` on the Vizier TAP service (`tapvizier.cds.unistra.fr`), written as `{ "<n>": <diam>, ... }`.

> **SH2 → NGC/IC/M/Abell merges (`SH2_ALIASES`):** many SH2 H-II regions are the same physical object as an already-catalogued nebula (most named/famous nebulae — Lagoon, Trifid, Omega, Eagle, Bubble, Cocoon, Crescent, Flame, North America, Heart, Soul, Pac-Man, Wizard, Thor's Helmet, Skull and Crossbones, Monkey Head, Rosette, Seagull, Running Man, several Abell planetary nebulae, etc. — have both an SH2 number and an NGC/IC/M designation). These are folded into the parent (designations appended to its `catalogs[]`, the SH2 row dropped) so the region is a single object rather than two entries at slightly different coordinates/sizes. See the `SH2_ALIASES` table in `generate-dso.mjs` for the full curated list (33 entries as of this writing) — each entry's inline comment names the object. The merge runs after all sources are loaded (Abell PNe come from a later step).
>
> When a physical complex genuinely has multiple valid NGC/IC numbers for distinct sub-features (e.g. Rosette Nebula = NGC 2237/2238/2246, Running Man = NGC 1973/1975/1977, Monkey Head cluster NGC 2175 vs. nebula NGC 2174), only the canonical/most-cited NGC number is merged with the SH2 designation — the sibling numbers are kept as separate objects, matching how they're actually catalogued.
>
> Note: the **Heart Nebula is IC 1805 / SH2-190** (SH2-198 is a small separate region near the Soul Nebula, not the Heart — an earlier mislabel that has been corrected), and there is no "Starfish Nebula" (vestigial bad name, removed). **Sh2-142 is the Wizard Nebula, not "Spider Nebula"** (a mislabel that was in the override file — corrected).
>
> **Alias-collision hazard:** `loadMetadataOverrides()` indexes every override entry by *each* of its own `catalogs[]` strings, last-write-wins. If object A's override entry lists object B's own id as one of its aliases (a copy-paste mistake), A's entry silently replaces B's in the lookup map — B's row then renders with A's name/size/rating instead of its own. This exact bug was found and fixed for **NGC 896 / IC 1805** (NGC 896 had wrongly claimed "IC1805" as its own alias, so the real IC 1805/Heart Nebula row was showing NGC 896's data — no name, wrong size, wrong rating). When adding or editing an override entry's `catalogs[]`, don't include another real object's own id unless they are in fact the same object (and if so, prefer registering the merge in `SH2_ALIASES`/`VDB_ALIASES`/etc. instead of hand-listing the alias).
>
> **NGC 1499's position angle** was blank in OpenNGC (defaults to 0°, drawing the ellipse north-south), but the real nebula runs diagonally. Measured PA≈120° (E of N) from a user's plate-solved photo — see `pa` override above.

## van den Bergh (vdB) reflection nebulae

The VII/21 van den Bergh (1966) catalog has **no NGC/IC column** and gives only galactic coordinates at 0.1° (~6′) precision, marking each nebula's **illuminating star**. The pipeline therefore handles vdB specially in `generate-dso.mjs`:

- **`VDB_ALIASES`** — a curated map of vdB number → existing NGC/IC/M/SH2/LBN id, for nebulae that are the same physical object but were not auto-matched (OpenNGC's `Identifiers` column omits the vdB id). Each merged vdB id is appended to the target row's `catalogs[]` and its standalone row is suppressed, so it inherits the target's precise position. Distinct objects merely *near* a cluster (vdB 23 ≈ M45, vdB 6 ≈ NGC 654) are intentionally **not** merged. Every mapping was verified against SIMBAD.
- **`scripts/vdb-coords.json`** (`VDB_COORDS`) — authoritative ICRS J2000 positions for standalone vdB rows, resolved from SIMBAD by illuminating star, replacing the coarse galactic→equatorial conversion (which was up to ~8′ off and skipped B1950→J2000 precession). Missing numbers fall back to the conversion.

Regenerate `vdb-coords.json` from SIMBAD's TAP service:

```bash
curl -s "https://simbad.cds.unistra.fr/simbad/sim-tap/sync" \
  --data-urlencode "request=doQuery" --data-urlencode "lang=ADQL" --data-urlencode "format=csv" \
  --data-urlencode "query=SELECT i.id, b.ra, b.dec FROM ident i JOIN basic b ON i.oidref=b.oid WHERE i.id LIKE 'VDB %'"
```

Keep only rows whose id is `VDB <n>` (drop multi-component `VDB <n>a/b/...`), and write `{ "<n>": [ra, dec], ... }`.

---

## Runtime User Overrides

In addition to the build-time overrides above, the app supports per-user DSO metadata edits at runtime. These are stored separately from `dso.json` and `dso-metadata-overrides.json`.

- **Storage**: SQLite table `dso_overrides` (id TEXT PRIMARY KEY, data TEXT) in the server's `data.db`. All fields from `DSOUserOverride` are supported: `names`, `ra`, `dec`, `constellation`, `rating`, `difficulty`, `type`.
- **API**: `GET /api/dso-overrides` (all), `PUT /api/dso-overrides/:id` (upsert), `DELETE /api/dso-overrides/:id`.
- **Frontend**: Loaded on startup by `dso-catalog.ts` and applied as an in-memory overlay on top of catalog data. The DSO editor modal (`dso-editor.ts`) is accessible from the sky-map DSO info panel and from each target card in the Targets view.
- **Export/Import**: Runtime overrides can be included in the export ZIP as `dso-overrides.json` (opt-in checkbox). Import respects a "Skip DSO metadata overrides" checkbox to prevent clobbering local edits.
