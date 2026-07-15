# Terrain (mountain) horizon

The app can overlay the observer's **real skyline** — the terrain (hills, mountains,
buildings) that rises above the flat astronomical horizon — on the local-date sky
projection, and feed it into the target recommender so DSOs hidden behind terrain are
excluded ("how low not to go" becomes azimuth-dependent).

A horizon profile is the terrain **altitude** (degrees above the astronomical horizon)
as a function of compass **azimuth**. It is obtained two ways: computed automatically
from an open elevation model, or imported from a file.

## Data model

`src/horizon-io.ts` owns the shared, DOM-free data model and helpers (unit-tested in
`tests/unit/horizon-io.test.ts`):

```ts
interface HorizonProfile {
  lat: number;
  lon: number;
  obsHeightM: number | null; // eye height above ground (m); null ⇒ default 1.7
  azStepDeg: number; // dense sample step; alts.length === 360 / azStepDeg
  alts: number[]; // horizon altitude (deg) at azimuth i * azStepDeg, 0 = N, CW
  source: 'auto' | 'import' | 'manual';
}
```

- `horizonAltAt(profile, azDeg)` — wrap-around linear interpolation; safe across the
  360→0 seam and for any azimuth. Used by both the renderer and the recommender.
- `densifyPoints(points, opts)` — turn sparse `(az, alt)` points into a dense profile.
- `parseHorizonFile(text)` — parse an `az,alt` CSV **or** the Stellarium _polygonal_
  horizon list (`az alt`, whitespace-separated) that PeakFinder and HeyWhatsThat both
  export. Comments (`#`, `//`) and blank lines are ignored.

## Auto-compute (backend)

`server/horizon.ts` — `computeHorizon(lat, lon, { radiusKm, obsHeightM })`:

1. **DEM source:** AWS `elevation-tiles-prod` **Terrarium** PNG tiles (open data, no key)
   at zoom 12 (~38 m/px at the equator), decoded with `sharp`. Elevation is RGB-encoded:
   `h = R*256 + G + B/256 - 32768`. Tiles for the `radiusKm` bounding box are fetched
   (capped at `MAX_TILES`) and assembled into one combined grid; a missing tile (out of
   coverage) is treated as sea level.
2. **Sampling:** bilinear `elevationAt(lat, lon)` over the combined grid.
3. **Ray-trace:** `traceHorizonAngles()` (pure, unit-tested in `tests/unit/horizon.test.ts`)
   marches each azimuth outward in `STEP_M` (30 m) steps to `radiusM`, tracking the max
   elevation angle with Earth-curvature + atmospheric-refraction drop:
   `angle = atan2(h - obsElev - d²/(2·R_eff), d)`, `R_eff = 6371000 / (1 - 0.13)`.
   Observer eye elevation = terrain-at-observer + `obsHeightM` (default 1.7 m). Angles are
   clamped to a floor (`-5°`) so a valley floor doesn't produce an arbitrarily low horizon.

Computation runs server-side (avoids browser CORS on tiles, keeps the heavy loop off the
render thread — same rationale as proxying astrometry.net) and is exposed as
`GET /api/horizon?lat=&lon=&radiusKm=&obsHeightM=`. Results are cached in the
`horizon_profiles` table keyed by rounded location + params (`horizonCacheKey` in
`server/db.ts`) — terrain is stable, so a computed skyline is reusable indefinitely.

> **Why not PeakFinder / HeyWhatsThat?** PeakFinder's API only embeds a visual panorama
> (iframe/canvas) — no raw azimuth→altitude data. HeyWhatsThat has horizon data but its
> endpoint is undocumented and "subject to change." Computing from an open DEM keeps the
> feature self-contained; the file-import path covers offline use and both apps' exports.

## Frontend

- `src/stores/horizon.ts` (Pinia) holds the active `profile`, whether it's shown
  (`enabled`), `obsHeightM`, `loading`/`error`. Compute is **always an explicit user
  action** (the "Compute horizon" button) — never automatic on a lat/lon keystroke — to
  avoid hammering the tile server. Persisted to `localStorage` (`horizon-settings-v1`);
  restored onto the canvas on boot via `applyToCanvas()` (called from `src/ui.ts`).
- UI lives in the location popover of `src/components/overlay/SkyTimeControl.vue`: eye-height
  input, Compute, Import (file picker → `parseHorizonFile`), Clear, plus a toolbar
  show/hide toggle (mountain icon).

## Rendering

`drawMountainHorizon()` in `src/sky-draw.ts` steps azimuth finely, reads
`horizonAltAt(profile, az)`, converts via `raDecFromAltAz → project → toCanvas` (same
pen-lifting pattern as `strokeAltCircle`), strokes the silhouette, and — in zenith
("local sky") mode — fills the band down to the alt=0 rim. Colours are the
`MOUNTAIN_HORIZON` canvas token (`src/canvas-theme.ts`). `sky-map.ts` draws it right after
`drawHorizonLine`, gated on date mode + observer location + `showMountainHorizon`.

## Named summits

The DEM carries no place names, so summit labels come from **OpenStreetMap** via the
**Overpass API** (`natural=peak` nodes — free, no key). `server/overpass.ts` holds a pure
`parseOverpassPeaks(json)` (unit-tested) plus `fetchPeaks(bbox)`. Public Overpass instances
frequently 504/429 or briefly hang, so `fetchPeaks` **retries** (primary tried twice, then two
fallback mirrors) with a 12 s per-attempt timeout and a descriptive `User-Agent`. The peak
bbox is capped to `PEAK_QUERY_RADIUS_M` (30 km) — a lighter query is far less likely to time out,
and distant peaks sit too low to matter. The `horizonCacheKey` carries a version (`HORIZON_CACHE_VERSION`)
so bumping it invalidates stale profiles (e.g. ones computed before summits existed).

In `computeHorizon`, after the ray-trace, `selectSkylineSummits(peaks, alts, observer, elevationAt)`
(pure, unit-tested) keeps only peaks that **sit on the skyline**: for each named peak it computes
azimuth (bearing) + distance from the observer and an elevation angle using the same curvature/refraction
model, then keeps it when the ray-traced crest at that azimuth is within `SKYLINE_TOL` (~0.5°) of the
peak's angle (hidden peaks are dropped). Peaks within ~2° of azimuth are deduped keeping the taller, and
the result is capped (~40) by elevation. Each summit's `altDeg` is set to the silhouette altitude at its
azimuth so its dot lands on the drawn ridge. The whole thing is **best-effort**: any Overpass
failure/timeout is caught (`logServerError('overpass_fetch_failed')`) and the horizon returns with an
empty `summits` array. Summits ride in the cached `horizon_profiles` JSON blob for free.

`drawSummitDots()` (`src/sky-draw.ts`) draws a small star-like dot (`SUMMIT_DOT` token) on each summit,
called right after `drawMountainHorizon`. Hover is wired like the star/DSO path: `findClosestSummit()`
in `sky-map.ts` (nearest within ~12 px, competes with star/DSO distance) fires `onSummitHover`, and
`src/ui.ts` builds a plain tooltip with the peak **name**, elevation (m), and distance.
Only auto-computed profiles carry summits (imported az/alt files have none).

## Recommender integration

`recommendTargets()` (`src/target-recommender.ts`) accepts `options.horizonProfile`. After
computing a target's peak altitude/time (`maxAltDuringWindow`), it computes the **peak-time
azimuth** and rejects the target when `maxAltDeg < horizonAltAt(profile, azDeg)`. The
Targets tab passes the active profile when the "Respect horizon" chip is on
(`respectHorizon` in `targets-prefs-v3`).

**Known limitation / future work:** gating uses the azimuth at _culmination_ only — a sound
MVP (an object hidden even at its peak is definitely blocked), but it does not model a
target that clears terrain for only part of the night. A fuller version would sample
altitude vs. the horizon across the visible window.
