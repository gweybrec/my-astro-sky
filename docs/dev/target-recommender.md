# Target Recommender Algorithm

`src/target-recommender.ts` — `recommendTargets(dsos, preset, location, dateNight, limit, options) → TargetSuggestion[]`

Ranks DSOs for a given night, observer location, and gear preset. Returns up to `limit` candidates sorted by composite score.

---

## Inputs

| Parameter                | Type                 | Description                                                                  |
| ------------------------ | -------------------- | ---------------------------------------------------------------------------- |
| `dsos`                   | `DSO[]`              | Pre-filtered DSO list (after Stage 1 user filters)                           |
| `preset`                 | `GearPreset`         | Gear config — drives FOV, limiting magnitude                                 |
| `location`               | `{ latDeg, lonDeg }` | Observer coordinates                                                         |
| `dateNight`              | `Date`               | Any moment on the target night (used to find the dark window)                |
| `limit`                  | `number`             | Max results (default 8; the UI passes 5000)                                  |
| `options.allowOversized` | `boolean`            | Keep objects larger than the frame up to a 3×3 mosaic, scored by panel count |
| `options.minAltDeg`      | `number`             | Minimum transit altitude threshold (default 20°)                             |
| `options.maxAltDeg`      | `number`             | Maximum altitude — time above it does not count as observable (default 90°)  |
| `options.horizonProfile` | `HorizonProfile`     | Terrain skyline; rejects objects hidden behind terrain at their peak azimuth |

---

## Pipeline

### Stage 1 — User filters (`filterTargetDSOs`, targets-view.ts:111)

Applied before `recommendTargets` is called. Each object is excluded if:

| Filter               | Prefs key               | Default      |
| -------------------- | ----------------------- | ------------ |
| DSO type             | `enabledTypes`          | All 11 types |
| Rating               | `enabledRatings`        | 1–5          |
| Difficulty           | `enabledDifficulties`   | 1–5          |
| Primary catalog      | `enabledCatalogs`       | All catalogs |
| Already photographed | `excludePhotographed`   | Off          |
| Constellation        | `enabledConstellations` | All          |

Catalog detection uses `getDSOCatalog(id)` which parses the DSO's primary ID prefix (`/^M\d/` → M, `NGC` → NGC, etc.).

---

### Stage 2 — Pre-scoring cuts (target-recommender.ts:63)

Applied inside `recommendTargets`, in order:

1. **`!majAxisArcmin`** — skips objects with null or zero angular size (FOV fit cannot be computed).

2. **`mag > magLimit`** — skips objects fainter than the photographic limiting magnitude:

   ```
   magLimit = min(15, 2 + 5·log10(apertureMm) + 4)
   ```

3. **`mightBeVisible(dec, lat, minAlt)`** — quick declination pre-filter to avoid expensive altitude sampling:

   ```
   maxPossible = 90 − |lat − dec|
   ```

   Skips the object if `maxPossible < minAlt`. This is an upper bound — the actual transit altitude equals `maxPossible` only when the observer's latitude equals the object's declination (transit at zenith).

4. **Twilight window** — computed by `twilightWindow(dateNight, lat, lon)`:
   - Tries sun < −18° (astronomical), falls back to −12° (nautical), then −6° (civil)
   - When the sun never reaches −18° (a summer night far north), the result's `noAstroDarkness` holds the window searched instead, and both apps show "Pas de nuit noire : cibles calculées pour les heures les plus sombres (start–end)" above the results.
   - If no dark window exists (polar day/night) → fallback: fixed 20:00–06:00 UTC  
     ⚠️ The fallback is longitude-independent; observers far from UTC+0 will get an approximate window.

5. **`altitudeOverWindow(ra, dec, lat, lon, start, end, minAlt, maxAlt, 10 min)`** — samples altitude every 10 minutes: the highest sampled value, when, and the minutes spent between `minAlt` and `maxAlt`.
   - Keeps the object when it spends at least `MIN_MINUTES_IN_RANGE` (60 min) in the range, or the whole window when that is shorter. An object peaking above `maxAlt` (M51 or M13 from mid-northern latitudes) is kept for the hours it is below it. An empty window (the user's hours miss the night) keeps nothing.
   - Otherwise the object is `too-high` when its peak is above `maxAlt`, else `too-low`.
   - **Known constraint**: 10-minute steps can miss the exact transit peak by up to ~2°.

---

### Stage 3 — Scoring (0–1 composite)

```
score = (0.45·altScore + 0.35·fovFitScore + 0.20·brightnessScore) · difficultyFactor · ratingFactor
difficultyFactor: 1/5 ×1, 2/5 ×0.95, 3/5 ×0.85, 4/5 ×0.72, 5/5 ×0.6   (×1 when unknown)
ratingFactor:     5★ ×1,  4★ ×0.9,   3★ ×0.8,   2★ ×0.7,   1★ ×0.6     (×1 when unknown)
```

The factors rank easier and finer targets above others placed and framed as well; the rest stay listed, lower. The difficulty factor is gentle at 3/5, where many showpiece nebulae sit (Rosette, Horsehead, Veil), and steep for the faint ones.

#### Altitude score

```
airmass(a) = 1 / sin(a)
altScore   = (airmass(minAlt) − airmass(maxAltDeg)) / (airmass(minAlt) − airmass(50°))   (0 below minAlt, 1 from 50°)
```

Airmass is the thickness of air the light crosses. It barely changes above 50° and grows fast near the horizon, so a target at 38° (M42 from France) keeps about 0.8 of the score while one just above `minAlt` gets little.

#### FOV fit score

Piecewise function of `ratio = frameFill(…)`: the object is an ellipse of its two axes (`minAxis` falls back to `majAxis`) turned to its best angle in the frame, and the ratio is how much its bounding box overfills the frame there (1 = it touches the edges). A long thin object can lie along the diagonal (√(w² + h²)). The box narrows along one side and widens along the other as the ellipse turns, so the best angle is where both fills meet: `cos²θ = (a²W² − b²H²) / ((a² − b²)(W² + H²))`, clamped to 0–90°.

| Ratio range | Score range | Interpretation              |
| ----------- | ----------- | --------------------------- |
| 0–0.03      | 0→0.3       | Object tiny relative to FOV |
| 0.03–0.15   | 0.3→0.7     | Small                       |
| 0.15–0.70   | 0.7→1.0     | **Sweet spot**              |
| 0.70–1.00   | 1.0→0.7     | Slightly large              |
| >1.00       | 0.7→0       | Too large for frame         |

An object **fits** the frame when `frameFill ≤ fitTolerance(preset)`: `FIT_TOLERANCE` (1.1, up to 10 % larger is only cut at its faint edges) or, on a smart telescope, `SMART_FIT_TOLERANCE` (1.25: its targets are framed for their bright core, such as the Pleiades' stars). The same margin applies to its mosaic area. With `allowOversized` ("Include objects larger than FOV"), an object that does not fit is counted in mosaic panels (`oversizePanels`: 20 % overlap, the orientation needing fewer). Up to `MAX_OVERSIZE_PANELS` (9, a 3×3) it is kept with a fit of 0.55 (2 panels) down to 0.15 (9 panels), so it ranks below well-framed objects; beyond that it stays out (`too-big`). Objects that fit keep the table above.

**Smart telescopes.** A setup whose telescope has a mosaic mode (`GearPreset.smartMosaic`, from the catalogue's `mosaic`) can enlarge its single frame up to `smartMosaicEnvelope` (Seestar and Dwarf: each side × its `scale`; Vespera: a long-edge and an area cap). An object larger than the frame but within that area (`needsSmartMosaic`) is kept whatever `allowOversized` says, never `too-big`, and marked `needsMosaic`. Its fit is scored against the mosaic area × 0.85, a little below an object that fits the frame. The apps show a violet "Mosaïque" chip on the result (its tooltip on desktop and the phone detail say "Mosaïque recommandée"); there is no panel count, since the user sizes the frame. Beyond the mosaic area the panel rule above applies.

#### Brightness score

```
brightnessScore = min(1, (magLimit − mag) / 4)      (0 below the limit)
```

0 at the magnitude limit, 1 when 4+ magnitudes brighter. With no magnitude (many faint nebulae), the difficulty stands in: `(5 − difficulty) / 4`, so an unmeasured faint planetary nebula does not count as average; with neither, 0.4.

---

### Stage 4 — Ranking

`finish` ranks the objects inside the criteria by score alone and keeps the first `limit`. There is no quota per object type: with rating and difficulty in the score the top mixes types by itself, where a quota pulled weak objects (a 1★ dark cloud) above strong ones.

---

### Stage 5 — Horizon direction filter

Applied **after** `recommendTargets` returns, in `runRecommendation` (targets-view.ts:1658). Only active when `enabledDirs.size < 4`.

| Filter        | Condition                                                            |
| ------------- | -------------------------------------------------------------------- |
| North / South | `dso.dec > lat` → "North"                                            |
| East / West   | `bestTimeUtc > solarMidnight` → "East" (object peaks after midnight) |

`solarMidnight = noon_UTC + (12 − lon/15) h`

Objects that peak before local solar midnight are "West" (already past meridian); those peaking after are "East" (still rising).

---

### Stage 6 — Sort and paginate

Results stored in `this.lastPool`, then sorted in `renderResults` by `prefs.sortBy`:

| Key                | Sorts by                             |
| ------------------ | ------------------------------------ |
| `rating` (default) | DSO rating ↓ (photographic interest) |
| `score`            | Composite score ↓                    |
| `altitude`         | Max altitude ↓                       |
| `transit`          | Transit time ↑ (earliest first)      |
| `magnitude`        | Magnitude ↑ (brightest first)        |
| `size`             | Angular size ↓                       |
| `fov-fit`          | FOV fit score ↓                      |
| `name`             | Display name A–Z                     |
| `difficulty`       | Difficulty ↑                         |

Page size: `prefs.pageSize` (default 15, options 5–50).

---

### Stage 7 — Objects outside the criteria

With `includeOutside` (both Targets tabs ask for it), objects that miss **only** the altitude range, the frame size or "Already photographed" are kept and returned apart in `result.outside`. Each carries its reasons in `outside` (`too-low`, `too-high`, `too-big`, `photographed`). The recommender's `keepOutside` option does this:

- `too-low` / `too-high` for an object that does not spend an hour in the altitude range: `too-high` when its peak is above the maximum, else `too-low`, and only when its peak is still above 0°. An object that never rises stays out.
- `too-big` when `includeOversized` is off, or when the object needs more than a 3×3 mosaic; and `photographed` only when `excludePhotographed` is on.
- `finish` ranks only the objects inside the criteria. The direction and sky-region filters apply to both lists.

The other criteria still leave objects out as before: type, catalogue, rating, difficulty, constellation, magnitude limit and terrain horizon.

Both apps list these objects after the targets, under "Outside your criteria (N)", in the same sort. Their card or row is dimmed and has one warning chip per reason (`outsideLabels` in `targets/outside.ts`). They open like any target. The result count is the targets only. Keeping them costs about a quarter more search time on the full catalogue.

---

## Altitude filter preferences

Two inputs control which objects are included by altitude:

| Pref        | Default | Meaning                                                             |
| ----------- | ------- | ------------------------------------------------------------------- |
| `minAltDeg` | 20°     | Time below it does not count — too low in the atmosphere            |
| `maxAltDeg` | 80°     | Time above it does not count — too near zenith for some mount types |

An object is kept when it spends at least an hour between the two (or the whole window, when shorter).

The old hardcoded floor was 30°. The new default of 20° recovers objects that were previously incorrectly filtered near northern limits (e.g., M10 and M12 from latitudes above 55°N).

---

## Known constraints

- **10-minute sampling step**: `altitudeOverWindow` samples altitude at discrete 10-minute intervals. The sampled maximum can be up to ~2° below the true transit altitude. Setting `minAltDeg` conservatively (e.g., 20° instead of the transit altitude) provides a safety margin.

- **Longitude-independent polar fallback**: when no twilight threshold is found (polar day/night), the sampling window defaults to 20:00–06:00 UTC regardless of the observer's longitude. Observers east of UTC+0 should expect the window to start 1–4 hours after local darkness begins.

- **Short summer windows at northern latitudes**: at latitudes around 48–53°N in June, astronomical twilight lasts only 1–2 hours centered on midnight UTC. Objects that transit just before or just after this window will be sampled at declining altitudes rather than at their peak. This affects scoring (lower `altScore`) but not hard exclusion unless the sampled altitude falls below `minAltDeg`.
