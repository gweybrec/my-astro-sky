# Imaging Recipe Algorithm

`src/imaging-recipe.ts` — `recommendRecipe(dso, preset) → ImagingRecipe`

Produces heuristic "ballpark" integration time and filter recommendations for a DSO/gear pair. The numbers are meant to be practical starting points, not precise radiometric calculations.

---

## Integration Time

### Difficulty tables (reference: 200 mm aperture)

Four tables cover the object families, indexed by `difficulty` 1–5:

| Difficulty | Default (EN, SNR, RN, DN) | Globular clusters (GC) | Open clusters (OC) | Planetary nebulae (PN) |
|:----------:|:-------------------------:|:----------------------:|:------------------:|:----------------------:|
| 1 | 0.25 h | 0.25 h | 0.15 h | 0.15 h |
| 2 | 0.75 h | 0.50 h | 0.33 h | 0.33 h |
| 3 | 2.5 h | 1.0 h | 0.75 h | 0.75 h |
| 4 | 4.0 h | 2.0 h | 1.5 h | 1.5 h |
| 5 | 8.0 h | 4.0 h | 3.0 h | 3.0 h |

Galaxies (GxS, GxE, GxI, Gx) share the Default table but get a capped aperture factor (see below).

**Why separate tables?** Compact, high surface-brightness objects (clusters, PN) reach useful SNR quickly — more integration yields diminishing returns far sooner than a large diffuse nebula. PN are tiny emission rings; stacking an hour on M57 with a 50 mm scope captures the full structure just as well as stacking 6 h.

### Aperture scaling

```
apertureFactor = (200 / apertureMm) ^ 1.5
```

Exponent 1.5 is softer than the physically exact quadratic (^2) to keep the recommendations practical. Every type family has a per-type cap to prevent multi-hour absurdities on 50 mm smart telescopes:

| Type family | Cap constant | Value | Rationale |
|-------------|:---:|:---:|---|
| GC, OC | `CLUSTER_MAX_APERTURE_FACTOR` | 3.0 | Resolution-limited; bright stars saturate SNR in <1 h on any aperture |
| PN | `PN_MAX_APERTURE_FACTOR` | 3.0 | Compact, high surface brightness; ring/shell structure readable in 30–60 min |
| Gx (all galaxy subtypes) | `GX_MAX_APERTURE_FACTOR` | 4.0 | Benefit from more time than clusters, but spiral structure is not 8× harder than for a 200 mm scope |
| EN, SNR, RN, DN, ? | `EN_MAX_APERTURE_FACTOR` | 5.0 | Large diffuse targets do scale with aperture, but capped to prevent 12h+ recommendations on tiny scopes |

| Aperture | Raw factor | GC/OC/PN | Gx | EN/RN/SNR/DN |
|:--------:|:----------:|:--------:|:--:|:------------:|
| 200 mm | 1.0 | 1.0 | 1.0 | 1.0 |
| 100 mm | 2.83 | 2.83 | 2.83 | 2.83 |
| 80 mm | 3.95 | 3.0 (capped) | 3.95 | 3.95 |
| 60 mm | 6.09 | 3.0 (capped) | 4.0 (capped) | 5.0 (capped) |
| 50 mm | 8.0 | 3.0 (capped) | 4.0 (capped) | 5.0 (capped) |
| 40 mm | 11.2 | 3.0 (capped) | 4.0 (capped) | 5.0 (capped) |

### Final clamping

`totalHours = clamp(base × apertureFactor, 0.15, MAX_TOTAL_HOURS)`

`MAX_TOTAL_HOURS = 6.0` — no single-session recommendation should exceed one long night. The 0.15 h floor ensures at least 9 minutes are recommended even on trivial targets.

### Magnitude fallback

When `dso.difficulty === null`, the algorithm falls back to a magnitude-band estimate (independent of DSO type):

| Band | Magnitude | Base hours at 200 mm |
|------|-----------|---------------------|
| bright | mag ≤ 9 | 1.5 h |
| medium | 9 < mag ≤ 12 | 3.5 h |
| faint | mag > 12 | 7.0 h |

The same per-type aperture cap and `MAX_TOTAL_HOURS` ceiling apply to these fallback values.

---

## Filter Selection

Decided by `dso.type`, `dso.displayName`, and `preset.mono` / `preset.builtIn`.

```
if (!mono || builtIn)
  → Single RGB broadband session
    note: noteColorCamera

else (mono camera, non-integrated scope)
  if type ∈ {EN, PN, SNR} OR displayName matches /nebul|nébul/i
    → Ha (40%) + OIII (40%) + SII (20%)  [narrowband]
      note: noteNarrowband
      if type = PN: omit SII
        note: notePlanetaryNeb
  else (GC, OC, Gx*, RN, DN, ?)
    → L (50%) + R (17%) + G (17%) + B (16%)  [LRGB]
      if type = GC or OC:
        note: noteCluster
```

### Sub-exposure durations

| Mode | bright (mag ≤ 9) | medium (9–12) | faint (mag > 12) |
|------|:----------------:|:-------------:|:----------------:|
| RGB / LRGB | 120 s | 300 s | 600 s |
| Narrowband | 300 s | 600 s | 900 s |

Sub-counts are derived as `round(filterHours × 3600 / subSeconds)`.

**Smart telescope firmware cap** — Smart scopes enforce a maximum sub-exposure in firmware. The table values are reduced to `min(tableSec, preset.maxSubSec)` for any preset that has a `maxSubSec` field. The cap comes from `max_sub_exposure_sec` in `resources/telescopes.json`; it does not affect total integration time, only the sub count (e.g. 45 min on Seestar S50 becomes 270 × 10 s instead of 23 × 120 s).

| Brand / model family | `max_sub_exposure_sec` |
|---|:---:|
| Unistellar (eVscope 2, Odyssey Pro, Equinox 2) | 4 s |
| Vaonis Vespera (all variants) | 10 s |
| ZWO Seestar S30 / S50 | 10 s |
| ZWO Seestar S30 Pro (EQ capable) | 30 s |
| Celestron Origin | 10 s |
| DwarfLab DWARF 3 / Mini | 60 s |

---

## Example Results

Vespera (50 mm, OSC, builtIn) — RGB path:

| Object | Type | Diff | Total |
|--------|------|:----:|------:|
| M13 | GC | 1 | ~45 min |
| M2 | GC | 2 | ~1 h 30 min |
| M57 Ring | PN | 2 | ~59 min |
| M97 Owl | PN | 2 | ~59 min |
| M27 Dumbbell | PN | 1 | ~27 min |
| M42 Orion | EN | 1 | ~1 h 15 min |
| NGC7023 Iris | RN | 5 | ~6 h |
| M51 | GxS | 1 | ~1 h |
| NGC4236 | GxS | 2 | ~3 h |
| M109 | GxS | 2 | ~3 h |

---

## Tuning Guide

| Constant | Effect |
|----------|--------|
| `HOURS_BY_DIFFICULTY_DEFAULT` | Base hours for EN, SNR, RN, DN at 200 mm (diff 1–5) |
| `HOURS_BY_DIFFICULTY_GC` | Base hours for globular clusters at 200 mm |
| `HOURS_BY_DIFFICULTY_OC` | Base hours for open clusters at 200 mm |
| `HOURS_BY_DIFFICULTY_PN` | Base hours for planetary nebulae at 200 mm |
| `CLUSTER_MAX_APERTURE_FACTOR` | Aperture cap for GC and OC (default 3.0) |
| `PN_MAX_APERTURE_FACTOR` | Aperture cap for PN (default 3.0) |
| `GX_MAX_APERTURE_FACTOR` | Aperture cap for all galaxy subtypes (default 4.0) |
| `EN_MAX_APERTURE_FACTOR` | Aperture cap for EN, SNR, RN, DN (default 5.0) |
| `MAX_TOTAL_HOURS` | Absolute ceiling applied to every result (default 6.0 h) |
| Aperture exponent (`** 1.5`) | Change to `** 2` for stricter physics; `** 1` for flatter scaling |

---

## Known Limitations

- The `difficulty` field in the DSO catalog was calibrated primarily with 100–200 mm instruments in mind. Values for clusters on tiny smart telescopes will still seem aggressive even after the cluster correction, because the cap at `CLUSTER_MAX_APERTURE_FACTOR = 3` is an approximation.
- The algorithm doesn't model sky darkness, moon phase, or light pollution — all of which strongly affect required integration time in practice.
- Very small apertures (<40 mm) are clamped by the 0.15 h floor but the sub-exposure suggestions remain unchanged (they're based only on magnitude band).
- Comets, asteroids, and double stars are not in the DSO catalog and not modelled here.
