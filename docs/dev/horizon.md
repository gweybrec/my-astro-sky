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

### Why not PeakFinder (or HeyWhatsThat)?

Two separate questions get asked here — "why not use PeakFinder for the **data**?" and the
subtler "why not use its **canvas** for the display?". Both resolve to _no_.

**Data.** PeakFinder's API returns no raw `azimuth → altitude` numbers, and we need that array
for the sky-map overlay, the recommender's terrain gate, and the summit placement. HeyWhatsThat
does expose horizon data, but through an undocumented endpoint that's "subject to change." An open
DEM keeps the whole feature self-contained and offline-capable; the import path
(`parseHorizonFile`) already reads the Stellarium-polygonal horizon that PeakFinder itself exports,
so a user who prefers PeakFinder's terrain can still bring it in.

**Display — why we can't "just draw what we want" on the PeakFinder panel canvas.** The embed is:

```js
let panel = new PeakFinder.PanoramaPanel({ canvasid: 'pfcanvas', locale: 'en' });
```

That object is a **self-contained viewer that _owns_ a canvas**, not a canvas we can paint on. The
distinction is the whole answer:

1. **It owns the element and its render loop.** The panel takes the `<canvas>` by id, holds its
   rendering context, and runs its own `requestAnimationFrame` loop redrawing the terrain panorama
   every frame. Anything we draw into that canvas is wiped on its next frame, and we don't control
   the loop — so we can't interleave our own stars/DSOs/grid, i.e. we cannot _composite_ onto it.
2. **Its methods are the entire contract.** We can only steer it through what it chooses to expose:
   `loadViewpoint(lat, lon, name)`, camera azimuth/altitude/FOV, `projection` (**0 perspective,
   1 cylindrical**), background colour, theme, locale, and "disable infosheets." There is no hook to
   pass a custom projection/camera matrix, no event to inject a draw pass, no layer ordering.
3. **The projection we need isn't on offer.** Perspective and cylindrical are both _outward-looking_
   horizon cameras. Our local-sky view is a **zenith-centred azimuthal dome** (zenith at the disc
   centre, horizon at the rim) driven by our own `project()` + `toCanvas()`. The panel's API has no
   mode for that and no way to reproject its output, so it can't render our view — the two camera
   models line up at a single point and diverge everywhere else.
4. **No geometry comes back out.** The panel exposes no terrain mesh or silhouette vertices, so we
   can't even read "where is the ridge" to reproject it into our disc ourselves. It's pixels-only.
5. **Reading its pixels is a dead end.** Scraping the canvas (`getImageData` / WebGL `readPixels`) is
   fragile, and because the panel textures imagery fetched from its servers the canvas is
   cross-origin **tainted**, so readback throws — and even if it didn't, we'd only recover
   their-projection pixels, not geometry.
6. **It's a black box.** The engine is a minified, versioned (`peakfinder.1.0.min.js`) bundle loaded
   from peakfinder.com; its internals aren't a supported surface to reach into or patch.

So "do whatever we want with that panel canvas" would require our projection (not offered),
compositing our celestial layers into its frames (its loop overwrites), and reading its geometry out
(not exposed) — none of which the object grants. It's a viewer you point at a location and nudge the
camera on, full stop.

**Self-hosting the script doesn't change this.** `loadViewpoint()` fetches terrain from PeakFinder's
servers on every viewpoint, so self-hosting `peakfinder.1.0.min.js` removes the CSP `script-src`
issue but not the runtime network dependency (our app is deliberately offline/privacy-first), and
redistributing their proprietary engine isn't granted (their docs say to include it from their URL;
the demo repo's LICENSE covers the demo, not the engine). Our CSP is same-origin
(`script-src`/`connect-src` `'self'`) with zero third-party embeds today, so an embed would also mean
relaxing that posture — for a view that still can't replace our overlay and still returns no data
(we'd maintain both pipelines).

Worth noting our DEM-geometry + OSM-names split is **not** a compromise: it mirrors PeakFinder's own
architecture (a DEM for terrain + a names database for labels). The gap is polish, not principle.

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

`drawMountainHorizon()` in `src/sky-draw.ts` renders the terrain as **solid shaded masses with no outline
lines** — depth comes from smooth atmospheric fog, the way PeakFinder does it. `computeHorizon` traces the
skyline at **fine nested distance shells** (`SHELL_KM = [2, 4, 7, 11, 16, 23]` plus the full radius) via
`traceHorizonAngles` — which returns one `alts` array per shell (near→far), snapshotting the running max as
each shell boundary is crossed — and stores them on `profile.layers` (`profile.alts` === the last/farthest
shell = the true horizon, used by the recommender + summit placement).

In zenith ("local sky") mode with `layers`, the renderer fills the shells **back-to-front** (far first): each
shell's ground band (silhouette → alt=0 rim, a per-azimuth quad strip via `fillSilhouetteBand`; per-wedge
fills avoid the single-polygon seam/inversion) is painted solid with `lerpColor(groundNear → groundFar)` by
shell index. With many close shells the overlapping opaque fills form a continuous near-dark → far-hazy
gradient that follows the terrain; the jagged ridge outlines are just the fill-vs-fill / fill-vs-sky
boundaries — **no crest lines are stroked** (that's what made it read as confusing concentric rings before).
A single radial `formShadow` gradient (transparent toward the zenith, dark at the rim) is overlaid on each
band to darken the masses toward their base for a little body. Where terrain is uniformly near the shells
collapse — no faked depth. Imported/manual profiles (no `layers`) and the pole-centred stereo view fall back
to a single `fill` + one thin `stroke` silhouette. `sampleDenseAz` (in `horizon-io.ts`) samples any shell's
`alts`, and `lerpColor` (`src/color-utils.ts`, unit-tested) ramps the tones. `sky-map.ts` draws it right
after `drawHorizonLine`, gated on date mode + observer location + `showMountainHorizon`. The
`HORIZON_CACHE_VERSION` bump (`v5`) forces cached profiles to recompute with the finer shells.

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

`drawSummitDots()` (`src/sky-draw.ts`) draws a small, subtle marker dot (`SUMMIT_DOT` token) on each
summit — **no always-on labels** (this is a sky app; permanent peak labels are clutter). The name shows
only on **hover**: `findClosestSummit()` in `sky-map.ts` (nearest within ~12 px, competes with star/DSO
distance) fires `onSummitHover`, and `src/ui.ts` builds a tooltip with the peak **name**, elevation (m),
and distance.
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
