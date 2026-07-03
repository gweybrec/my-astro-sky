---
name: override-dso-metadata
description: >
  Override or correct default DSO metadata in the static catalog. Use when a DSO has
  a wrong name (fr/en/es/de), wrong type (e.g. marked as '?' when it's EN), wrong
  coordinates, or wrong constellation/rating/difficulty. Covers editing
  dso-metadata-overrides.json and regenerating public/data/dso.json.
  Trigger phrases: "wrong DSO name", "fix DSO type", "correct DSO coordinates",
  "add DSO proper name", "override DSO", "update catalog metadata", "regenerate dso.json".
---

# Override DSO Metadata

## Unit tests

This skill modifies only static data files (`dso-metadata-overrides.json`) and runs a pre-existing generator script. No new logic is introduced, so no unit tests are required. The sanity check in Step 5 is sufficient verification.

---

## When to use

- A DSO has a wrong or missing proper name (any language)
- A DSO is typed as `?` or the wrong type (e.g. spiral galaxy labelled as `GxI`)
- Coordinates are wrong (verified against SIMBAD)
- `constellation`, `rating`, or `difficulty` need correction
- A TODO entry lists a name/type fix (e.g. "NGC5907 Knife Edge Galaxy and is spiral")

**Runtime overrides vs catalog overrides:** This skill handles the _static catalog_ (`public/data/dso.json`). For per-user, per-session overrides stored in the database, see `server/db.ts` (`dso_overrides` table) — those don't require regenerating the catalog.

---

## Step 1 — Locate or create the entry in `scripts/dso-metadata-overrides.json`

The file is an array of objects. Find the entry by `id` (case-insensitive, e.g. `"NGC5907"`). If none exists, append a new one.

**Lookup by catalog alias:** The generator also indexes entries by each element of `catalogs`. If `M42` and `NGC1976` are in the same `catalogs` array, either id resolves to the same override. Always include all known catalog IDs in the `catalogs` array.

---

## Step 2 — Edit the entry

### Full entry schema

```jsonc
{
  "id": "NGC5907", // required — primary catalog ID, matches dso.json id field
  "catalogs": ["NGC5907"], // all known catalog IDs for this object (used for lookup)
  "constellation": "Dra", // optional — IAU 3-letter code; omit if unchanged
  "rating": 4, // optional — 1–5 photographic interest; omit if unchanged
  "difficulty": 3, // optional — 1–5 imaging effort; omit if unchanged
  "type": "GxS", // optional — corrected type code (see table below)
  "ra": 228.973, // optional — J2000 decimal degrees; omit if unchanged
  "dec": 56.329, // optional — J2000 decimal degrees; omit if unchanged
  "names": {
    // optional — omit the whole block if no name change
    "fr": "Lame de couteau",
    "en": "Knife Edge Galaxy",
  },
}
```

### Type codes

| Code  | Meaning               |
| ----- | --------------------- |
| `GxS` | Spiral galaxy         |
| `GxE` | Elliptical galaxy     |
| `GxI` | Irregular galaxy      |
| `Gx`  | Galaxy (type unknown) |
| `OC`  | Open cluster          |
| `GC`  | Globular cluster      |
| `EN`  | Emission nebula       |
| `RN`  | Reflection nebula     |
| `PN`  | Planetary nebula      |
| `SNR` | Supernova remnant     |
| `DN`  | Dark nebula           |
| `?`   | Unknown               |

### Minimal example — name-only override

```jsonc
{
  "id": "NGC6543",
  "catalogs": ["NGC6543"],
  "constellation": "Dra",
  "rating": 4,
  "difficulty": 2,
  "names": {
    "fr": "Nébuleuse de l'Œil de Chat",
    "en": "Cat's Eye Nebula",
    "es": "Nebulosa Ojo de Gato",
    "de": "Katzenaugen-Nebel",
  },
}
```

### Minimal example — type correction only

```jsonc
{
  "id": "NGC5907",
  "catalogs": ["NGC5907"],
  "constellation": "Dra",
  "rating": 4,
  "difficulty": 3,
  "type": "GxS",
}
```

---

## Step 3 — Verify name accuracy (required)

### Common names are official designations — never invent translations

> **CRITICAL:** Common names (`nameEn`, `nameFr`, `nameEs`, `nameDe`) are internationally recognized astronomical designations established by convention, **not translations of each other**. Do not derive a name in one language by translating the name from another language. Each language has its own established common name, or none at all.
>
> Examples of names that differ across languages:
>
> - NGC4565: English "Needle Galaxy" / French "Galaxie de l'Aiguille" (established in FR literature)
> - NGC5866: English "Spindle Galaxy" / French "Galaxie du Fuseau" (established in FR literature)
> - A hypothetical object may have an English common name but no established French name — in that case, omit `fr` entirely rather than translating.
>
> **Only add a name you can verify from an authoritative source.** Accepted sources: SIMBAD's name list for the object, well-known printed star atlases, or specialist astronomy references. If you cannot find a sourced name for a language, leave that field absent.

Also check the name isn't already used for a different object. See `docs/dev/dso-catalog.md` for the SIMBAD validation workflow and known data quality issues.

---

## Step 4 — Regenerate `public/data/dso.json`

```bash
node scripts/generate-dso.mjs
```

`applyMetadataOverrides()` runs at the end of the pipeline (after all catalog sources are merged) and overwrites the relevant fields for every matched row.

**After changing `ra` or `dec`**, also recompute constellations:

```bash
node scripts/add-constellations.mjs
```

**After changing `rating` or `difficulty`** directly in the override file, the values are applied by `generate-dso.mjs` — no extra step needed. Only if the _scoring formula_ in `scripts/add-ratings.mjs` changes do you need the strip-and-regenerate cycle described in `docs/dev/dso-catalog.md`.

---

## Step 5 — Quick sanity check

```bash
node -e "
const d = JSON.parse(require('fs').readFileSync('public/data/dso.json','utf8'));
const fi = d.fields;
const row = d.data.find(r => r[fi.indexOf('id')] === 'NGC5907');
console.log(JSON.stringify(Object.fromEntries(fi.map((f,i)=>[f,row[i]]))));
"
```

Replace `NGC5907` with the id you changed. Confirm `type`, `nameEn`, `nameFr`, `ra`, `dec`, `constellation` look correct.

---

## Batch additions from a TODO list

When a TODO entry lists several name/type fixes (e.g. the block starting at line 13 in `TODO.txt`), process them in one editing pass on `dso-metadata-overrides.json`, then run `generate-dso.mjs` once. After confirming the output, remove the resolved lines from `TODO.txt`.
