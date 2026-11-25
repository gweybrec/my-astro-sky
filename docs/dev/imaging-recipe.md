# Imaging Recipe Algorithm

`packages/core/src/imaging-recipe.ts` — `recommendRecipe(dso, preset) → ImagingRecipe`

Produces heuristic "ballpark" integration time and filter recommendations for a DSO/gear pair. The numbers are meant to be practical starting points, not precise radiometric calculations.

---

## Integration Time

### Difficulty tables

Four tables cover the object families, indexed by `difficulty` 1–5. They give the time for a good result, not a first look: nebulae and galaxies at f/5, the others at a 200 mm aperture.

| Difficulty | Nebulae and galaxies (EN, SNR, RN, DN, Gx\*) — f/5 | Globular clusters (GC) | Open clusters (OC) | Planetary nebulae (PN, PPN) |
| :--------: | :------------------------------------------------: | :--------------------: | :----------------: | :-------------------------: |
|     1      |                       2.0 h                        |         0.25 h         |       0.15 h       |            1.0 h            |
|     2      |                       3.0 h                        |         0.50 h         |       0.33 h       |            1.5 h            |
|     3      |                       5.0 h                        |         1.0 h          |       0.75 h       |            2.5 h            |
|     4      |                       8.0 h                        |         2.0 h          |       1.5 h        |            6.0 h            |
|     5      |                       25.0 h                       |         4.0 h          |       3.0 h        |           25.0 h            |

Even the easiest nebula or galaxy (M42, M31, M81) takes amateurs a few hours. Difficulty 4–5 ones (faint Sharpless/LBN regions, old planetary nebulae such as Abell 31 or Outters 4) are multi-night projects, hence tens of hours. A planetary nebula's difficulty comes from its surface brightness (see `docs/dev/dso-catalog.md`), so PN difficulty 1–2 are the small bright ones and 4–5 the large faint ones.

An open cluster that carries a nebula catalogue number (LBN, Sharpless, vdB, RCW — the Wizard is SH2-142, the Christmas Tree SH2-273) is imaged for its nebula: it takes the nebula table and focal-ratio scaling, and narrowband when the number is a Sharpless or RCW one (emission regions only).

**Why separate tables?** Compact, high surface-brightness objects (clusters, PN) reach useful SNR quickly — more integration yields diminishing returns far sooner than a large diffuse nebula.

### Focal-ratio scaling (nebulae and galaxies)

```
fRatioFactor = clamp((focalLength / aperture / 5)², 0.4, 5)
```

On an extended object the light per pixel depends on the focal ratio, not on the aperture: a C8 at f/10 needs four times what an f/5 refractor does, and about 2.5× at f/6.3.

### Aperture scaling (clusters and planetary nebulae)

```
apertureFactor = (200 / apertureMm) ^ 1.5
```

Exponent 1.5 is softer than the physically exact quadratic (^2) to keep the recommendations practical. Compact targets are capped so 50 mm smart telescopes do not get multi-hour absurdities:

| Type family |         Cap constant          | Value | Rationale                                                                      |
| ----------- | :---------------------------: | :---: | ------------------------------------------------------------------------------ |
| GC, OC      | `CLUSTER_MAX_APERTURE_FACTOR` |  3.0  | Resolution-limited; bright stars saturate SNR in <1 h on any aperture          |
| PN, PPN     |   `PN_MAX_APERTURE_FACTOR`    |  3.0  | Compact, high surface brightness; ring/shell structure readable in a few hours |

### Final clamping

`totalHours = clamp(base × factor, floor, MAX_TOTAL_HOURS)`

`MAX_TOTAL_HOURS = 40.0` — the faintest targets on a small aperture are several nights' work, not a season's. The floor is 45 min for a globular cluster and 30 min for an open cluster (a stack needs some frames to be clean), 0.15 h otherwise.

### Magnitude fallback

When `dso.difficulty === null`, the algorithm falls back to a magnitude-band estimate (independent of DSO type):

| Band   | Magnitude    | Base hours at 200 mm |
| ------ | ------------ | -------------------- |
| bright | mag ≤ 9      | 2.0 h                |
| medium | 9 < mag ≤ 12 | 3.5 h                |
| faint  | mag > 12     | 7.0 h                |

The same per-type factor, floor and `MAX_TOTAL_HOURS` ceiling apply to these fallback values.

---

## Filter Selection

Decided by `dso.type`, `dso.displayName`, and `preset.mono` / `preset.builtIn`.

```
if (!mono || builtIn)
  → Single RGB broadband session
    note: noteColorCamera

else (mono camera, non-integrated scope)
  if type ≠ PPN AND (type ∈ {EN, PN, SNR} OR displayName matches /nebul|nébul/i)
    or an open cluster carrying a Sharpless or RCW number
    → Ha (40%) + OIII (40%) + SII (20%)  [narrowband]
      note: noteNarrowband
      if type = PN: omit SII, Ha (50%) + OIII (50%)
        note: notePlanetaryNeb
  else (GC, OC, Gx*, RN, DN, PPN, ?)  — a protoplanetary nebula shines by scattered starlight
    → L (50%) + R (17%) + G (17%) + B (16%)  [LRGB]
      if type = GC or OC:
        note: noteCluster
```

> **Suggested-filter badges stay generic on purpose.** The recipe recommends a
> _band_ (`Ha`, `OIII`, `L`…), not a product, so the "Suggested filters" badges on
> result cards keep the generic names and their `--filter-{key}` token colours.
> This is deliberately distinct from the **filter catalog** (`resources/filters.json`,
> surfaced via `gear-catalog.ts`), which is used when a user tags an _actual_
> acquisition — the photo integration rows and the plan observation-window picker.
> There, a real product ("Antlia Pro Luminance") is chosen and rendered in its own
> catalogued colour. The two never collide: no catalog product is allowed to share a
> name with a generic band (guarded in `tests/unit/filters-json-schema.test.ts`), so
> `createFilterBadge('Ha')` always takes the generic path.

### Sub-exposure durations

| Mode       | bright (mag ≤ 9) | medium (9–12) | faint (mag > 12) |
| ---------- | :--------------: | :-----------: | :--------------: |
| RGB / LRGB |      120 s       |     300 s     |      600 s       |
| Narrowband |      300 s       |     600 s     |      900 s       |

Sub-counts are derived as `round(filterHours × 3600 / subSeconds)`, with at least `MIN_SUBS_PER_FILTER` (20) per filter: fewer cannot be stacked with outlier rejection. When a filter's hours give fewer, the sub is shortened to the longest usual length that gives 20 (60, 90, 120, 180, 240, 300 or 600 s, never longer than the original), then time is added if 60 s subs still fall short. The recipe's total is the sum of its filters.

**Smart telescope firmware cap** — Smart scopes enforce a maximum sub-exposure in firmware. The table values are reduced to `min(tableSec, preset.maxSubSec)` for any preset that has a `maxSubSec` field. The cap comes from `max_sub_exposure_sec` in `resources/telescopes.json`; it does not affect total integration time, only the sub count (e.g. 45 min on Seestar S50 becomes 270 × 10 s instead of 23 × 120 s).

| Brand / model family                           | `max_sub_exposure_sec` |
| ---------------------------------------------- | :--------------------: |
| Unistellar (eVscope 2, Odyssey Pro, Equinox 2) |          4 s           |
| Vaonis Vespera (all variants)                  |          10 s          |
| ZWO Seestar S30 / S50                          |          10 s          |
| ZWO Seestar S30 Pro (EQ capable)               |          30 s          |
| Celestron Origin                               |          10 s          |
| DwarfLab DWARF 3 / Mini                        |          60 s          |

---

## Example Results

Seestar S50 (50 mm f/5, OSC, builtIn) — RGB path:

| Object       | Type | Diff |  Total |
| ------------ | ---- | :--: | -----: |
| M13          | GC   |  1   | 45 min |
| M2           | GC   |  2   |  1.5 h |
| M57 Ring     | PN   |  1   |  3.0 h |
| M97 Owl      | PN   |  2   |  4.5 h |
| M27 Dumbbell | PN   |  1   |  3.0 h |
| M42 Orion    | EN   |  1   |  2.0 h |
| NGC7023 Iris | RN   |  5   | 25.0 h |
| M51          | GxS  |  1   |  2.0 h |
| NGC4236      | GxS  |  2   |  3.0 h |
| M109         | GxS  |  2   |  3.0 h |

The same nebula or galaxy takes 2 h on a RedCat 51 (f/4.9), about 3 h on a C8 with its f/6.3 reducer and 8 h on a C8 at f/10.

---

## Tuning Guide

| Constant                      | Effect                                                            |
| ----------------------------- | ----------------------------------------------------------------- |
| `HOURS_BY_DIFFICULTY_DEFAULT` | Base hours for EN, SNR, RN, DN and galaxies at f/5 (diff 1–5)     |
| `HOURS_BY_DIFFICULTY_GC`      | Base hours for globular clusters at 200 mm                        |
| `HOURS_BY_DIFFICULTY_OC`      | Base hours for open clusters at 200 mm                            |
| `HOURS_BY_DIFFICULTY_PN`      | Base hours for planetary nebulae at 200 mm                        |
| `REFERENCE_F_RATIO`           | Focal ratio the nebula/galaxy table is given at (default 5)       |
| `MIN_F_RATIO_FACTOR` / `MAX_` | Bounds of the focal-ratio factor (default 0.4 and 5)              |
| `MIN_HOURS_GC` / `_OC`        | Least total for a cluster (default 0.75 h and 0.5 h)              |
| `MIN_SUBS_PER_FILTER`         | Least subs per filter (default 20)                                |
| `CLUSTER_MAX_APERTURE_FACTOR` | Aperture cap for GC and OC (default 3.0)                          |
| `PN_MAX_APERTURE_FACTOR`      | Aperture cap for PN (default 3.0)                                 |
| `MAX_TOTAL_HOURS`             | Absolute ceiling applied to every result (default 40 h)           |
| Aperture exponent (`** 1.5`)  | Change to `** 2` for stricter physics; `** 1` for flatter scaling |

---

## Known Limitations

- The `difficulty` field in the DSO catalog was calibrated primarily with 100–200 mm instruments in mind. Values for clusters on tiny smart telescopes will still seem aggressive even after the cluster correction, because the cap at `CLUSTER_MAX_APERTURE_FACTOR = 3` is an approximation.
- The algorithm doesn't model sky darkness, moon phase, or light pollution — all of which strongly affect required integration time in practice.
- An open cluster imaged for nebulosity catalogued separately (the Pleiades: its reflection nebulae are vdB 20–23, not on M45) keeps the cluster time.
- Comets, asteroids, and double stars are not in the DSO catalog and not modelled here.
