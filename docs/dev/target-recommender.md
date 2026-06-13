# Target Recommender Algorithm

`src/target-recommender.ts` — `recommendTargets(dsos, preset, location, dateNight, limit, options) → TargetSuggestion[]`

Ranks DSOs for a given night, observer location, and gear preset. Returns up to `limit` candidates sorted by composite score.

---

## Inputs

| Parameter | Type | Description |
|-----------|------|-------------|
| `dsos` | `DSO[]` | Pre-filtered DSO list (after Stage 1 user filters) |
| `preset` | `GearPreset` | Gear config — drives FOV, limiting magnitude |
| `location` | `{ latDeg, lonDeg }` | Observer coordinates |
| `dateNight` | `Date` | Any moment on the target night (used to find the dark window) |
| `limit` | `number` | Max results (default 8; the UI passes 5000) |
| `options.ignoreFovFit` | `boolean` | Force `fovFitScore = 1.0` for all objects |
| `options.minAltDeg` | `number` | Minimum transit altitude threshold (default 20°) |
| `options.maxAltDeg` | `number` | Maximum transit altitude threshold — rejects near-zenith objects (default 90°) |

---

## Pipeline

### Stage 1 — User filters (`filterTargetDSOs`, targets-view.ts:111)

Applied before `recommendTargets` is called. Each object is excluded if:

| Filter | Prefs key | Default |
|--------|-----------|---------|
| DSO type | `enabledTypes` | All 11 types |
| Rating | `enabledRatings` | 1–5 |
| Difficulty | `enabledDifficulties` | 1–5 |
| Primary catalog | `enabledCatalogs` | All catalogs |
| Already photographed | `excludePhotographed` | Off |
| Constellation | `enabledConstellations` | All |

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
   - If no dark window exists (polar day/night) → fallback: fixed 20:00–06:00 UTC  
   ⚠️ The fallback is longitude-independent; observers far from UTC+0 will get an approximate window.

5. **`maxAltDuringWindow(ra, dec, lat, lon, start, end, 10 min)`** — samples altitude every 10 minutes and returns the highest sampled value.
   - Skips object if `maxAltDeg < minAlt` or `maxAltDeg > maxAlt`.
   - **Known constraint**: 10-minute steps can miss the exact transit peak by up to ~2°. For objects where the transit altitude barely exceeds `minAlt`, this can cause false negatives. Reduce `minAltDeg` (default 20°) to give a safety margin.

---

### Stage 3 — Scoring (0–1 composite)

```
score = 0.45·altScore + 0.35·fovFitScore + 0.20·brightnessScore
```

#### Altitude score
```
altScore = clamp((maxAltDeg − minAlt) / (70 − minAlt), 0, 1)
```
Score saturates at 1 when `maxAltDeg ≥ 70°`. Objects between `minAlt` and 70° score linearly.

#### FOV fit score
Piecewise function of `ratio = majAxisArcmin / (60 · minFovDeg)`:

| Ratio range | Score range | Interpretation |
|-------------|-------------|----------------|
| 0–0.03 | 0→0.3 | Object tiny relative to FOV |
| 0.03–0.15 | 0.3→0.7 | Small |
| 0.15–0.70 | 0.7→1.0 | **Sweet spot** |
| 0.70–1.00 | 1.0→0.7 | Slightly large |
| >1.00 | 0.7→0 | Too large for frame |

When `ignoreFovFit = true`, this score is fixed at 1.0 for all objects.

#### Brightness score
```
brightnessScore = min(1, (magLimit − mag) / 4)
```
Score is 0 at the magnitude limit and saturates at 1 when 4+ magnitudes brighter.

---

### Stage 4 — Diversity cap + top-up

```typescript
// First pass: max 2 of each DSO type
for (const c of sorted) {
  typeCounts[c.dso.type]++;
  if (typeCounts[c.dso.type] <= 2) diverse.push(c);
  if (diverse.length >= limit) break;
}
// Top-up: add all remaining candidates in score order
if (diverse.length < limit) {
  for (const c of candidates) {
    if (!diverse.includes(c)) diverse.push(c);  // O(n²) — OK for typical result counts
    if (diverse.length >= limit) break;
  }
}
```

**Intent**: ensure result variety (not 8 galaxies). **Practical effect with limit=5000**: the first pass puts 2 of each type into `diverse`, then the top-up immediately appends all remaining candidates. The cap is effectively a no-op when `limit` >> number of candidates.

With a small `limit` (e.g., the default 8), the cap has real effect: each type gets at most 2 slots in the top results before the top-up fills remaining slots with the next-highest-scoring objects regardless of type.

---

### Stage 5 — Horizon direction filter

Applied **after** `recommendTargets` returns, in `runRecommendation` (targets-view.ts:1658). Only active when `enabledDirs.size < 4`.

| Filter | Condition |
|--------|-----------|
| North / South | `dso.dec > lat` → "North" |
| East / West | `bestTimeUtc > solarMidnight` → "East" (object peaks after midnight) |

`solarMidnight = noon_UTC + (12 − lon/15) h`

Objects that peak before local solar midnight are "West" (already past meridian); those peaking after are "East" (still rising).

---

### Stage 6 — Sort and paginate

Results stored in `this.lastPool`, then sorted in `renderResults` by `prefs.sortBy`:

| Key | Sorts by |
|-----|----------|
| `rating` (default) | DSO rating ↓ (photographic interest) |
| `score` | Composite score ↓ |
| `altitude` | Max altitude ↓ |
| `transit` | Transit time ↑ (earliest first) |
| `magnitude` | Magnitude ↑ (brightest first) |
| `size` | Angular size ↓ |
| `fov-fit` | FOV fit score ↓ |
| `name` | Display name A–Z |
| `difficulty` | Difficulty ↑ |

Page size: `prefs.pageSize` (default 15, options 5–50).

---

## Altitude filter preferences

Two inputs control which objects are included by altitude:

| Pref | Default | Meaning |
|------|---------|---------|
| `minAltDeg` | 20° | Exclude objects that never reach this altitude — too low in atmosphere |
| `maxAltDeg` | 80° | Exclude objects that exceed this altitude — too near zenith for some mount types |

The old hardcoded floor was 30°. The new default of 20° recovers objects that were previously incorrectly filtered near northern limits (e.g., M10 and M12 from latitudes above 55°N).

---

## Known constraints

- **10-minute sampling step**: `maxAltDuringWindow` samples altitude at discrete 10-minute intervals. The sampled maximum can be up to ~2° below the true transit altitude. Setting `minAltDeg` conservatively (e.g., 20° instead of the transit altitude) provides a safety margin.

- **Longitude-independent polar fallback**: when no twilight threshold is found (polar day/night), the sampling window defaults to 20:00–06:00 UTC regardless of the observer's longitude. Observers east of UTC+0 should expect the window to start 1–4 hours after local darkness begins.

- **Short summer windows at northern latitudes**: at latitudes around 48–53°N in June, astronomical twilight lasts only 1–2 hours centered on midnight UTC. Objects that transit just before or just after this window will be sampled at declining altitudes rather than at their peak. This affects scoring (lower `altScore`) but not hard exclusion unless the sampled altitude falls below `minAltDeg`.
