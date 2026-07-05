# Canvas Render Performance

How the sky-map render loop (`src/sky-map.ts`) was profiled and sped up, written as a set of **transferable techniques** rather than a changelog. The map redraws the whole sky on every pan/zoom frame — 10k+ stars and 12k+ DSOs projected and drawn to a 2D canvas — so the per-frame `render()` path is the hot path and the rules below apply to any per-frame canvas loop.

The worked example cut pan frame time ~45% (64 ms → 35 ms median) and zoom frame time ~3.5× (84 ms → 24 ms median) at above-average star/DSO density, with no visible change to the output.

---

## How to profile (do this first)

Never optimise from intuition — capture a Chrome DevTools **Performance** trace while doing the slow interaction (pan/zoom at high density), then read it. The trace JSON embeds a CPU sampling profile (`Profile` + `ProfileChunk` events with `nodes`, `samples`, `timeDeltas`). Two numbers matter:

- **Self time** per function — where the CPU actually is. Aggregate `timeDeltas` by the sample's leaf node, keyed by function name. Subtract `(idle)` to get _active_ CPU; report everything as a % of active, not wall-clock.
- **Inclusive time** — walk each sample's parent chain (dedup per sample to avoid double-counting recursion) to attribute cost to callers like `render()`.

A throwaway Node script over the exported `Trace-*.json` is enough — group by `callFrame.functionName`, sort by summed `timeDeltas`. The original trace pointed straight at `renderStars` (886 ms self), `project` (323 ms), and the canvas gradient builtins (`addColorStop` 339 ms, `fillRect` 233 ms, `createRadialGradient` 99 ms).

**Always measure before/after on an identical scripted interaction.** A clean A/B (stash the change, run the same synthetic pan, restore, run again) is the only honest way to claim a speedup. We drove a deterministic circular pan via dispatched mouse events and recorded `requestAnimationFrame` deltas; for the sprite work we also counted `document.createElement('canvas')` calls to expose hidden allocation churn.

---

## Technique 1 — Hoist position-invariant work out of the per-frame loop

The single biggest win. The per-frame loop recomputed things that **do not change when you pan or zoom**.

### 1a. Cache pure transforms with a generation counter

`project(ra, dec)` (stereographic projection, `src/projection.ts`) runs trig and allocates a `{x, y}` for every star and DSO — but its output depends _only_ on hemisphere and projection mode, not on pan/zoom (those are applied later by `toCanvas`, which is just scale + offset + rotation). A star's sky position never changes.

The fix is a **generation counter**: a module-level integer bumped only when hemisphere or projection mode changes. Each object memoises its projection plus the generation it was computed for; `projectCached` recomputes only when the generation has moved.

```ts
let _projGeneration = 0;
export function setHemisphere(h) {
  if (h !== _hemisphere) {
    _hemisphere = h;
    _projGeneration++;
  }
}

export function projectCached(o: ProjCacheHost): void {
  if (o._pg !== _projGeneration) {
    // stale → recompute once
    const p = project(o.ra, o.dec);
    o._px = p.x;
    o._py = p.y;
    o._pg = _projGeneration;
  }
}
```

Callers then read `o._px / o._py` directly — no return value, so panning re-projects nothing and allocates nothing. This dropped `project` from 323 ms (8% of active CPU) to **27 ms (0.4%)** and removed the allocation pressure that was driving GC.

> **Pattern:** a _generation/epoch counter_ is the cleanest cache-invalidation primitive when the inputs change rarely and atomically. Bump on the rare event; compare a stored stamp on the hot path. No per-object subscriptions, no manual cache clears scattered through the code. The one rule: **every** mutation of the underlying state must route through the function that bumps the counter (here, all hemisphere/mode changes go through `setHemisphere`/`setProjectionMode`).

> **The failure mode, learned the hard way.** That "one rule" is exactly where this kind of cache bites you. The projection also changes when a user _override_ edits a DSO's `ra`/`dec` — a path that does **not** go through `setHemisphere`. The first cut of the cache missed it, so an edited DSO kept rendering and hit-testing at its old position until the next hemisphere toggle. The fix is a dedicated `invalidateProjections()` (just `_projGeneration++`) called from the override path. When you add a generation cache, enumerate _every_ writer of the underlying state — not just the obvious one — and make each bump the counter.

### 1b. Precompute pure derived values at load, not per frame

`getDSOCatalog(id)` mapped a DSO id to its catalog prefix with a regex + a chain of `startsWith` — run for every DSO **every frame** during the selection pass. The id is immutable, so the result is computed **once at load** and stored as a field (`dso.catalog`). The per-frame line becomes a field read. Cost: 48 ms → gone.

> **Pattern:** if a per-frame computation is a pure function of immutable per-object data, move it to where the object is built. Free win, zero invalidation logic.

### 1c. Cache per-object factors that depend only on slow-changing state

`angularSizeToCanvasPx(arcmin, dec, scale)` recomputes `cos²((90∓dec)/2)` — which depends only on the object's `dec` and the hemisphere — and was called 2–3× per DSO per frame. The `dec` factor is cached per-DSO, invalidated by the same projection generation as 1a:

```ts
function angularSizeToCanvasPx(arcmin, decDeg, scale, cos2?) {
  if (cos2 === undefined) {
    /* compute from dec + hemisphere */
  }
  return (((arcmin / 60) * Math.PI) / 180 / (2 * cos2)) * scale;
}
```

Note the **optional cached argument** rather than a second function. This keeps a _single_ code path, which matters here because the **hit-test must match the render** pixel-for-pixel: rendering passes the cached `cos²`, hit-testing omits it, both run the identical formula. Diverging the two would make clicks miss objects.

---

## Technique 2 — Replace a per-element expensive primitive with a cached sprite

Stars were drawn with a per-star radial gradient: `createRadialGradient` + up to ~15 `addColorStop` calls (a 12-step glow falloff) + `fillRect`, **rebuilt every frame for every visible star**. Combined that was ~40% of active CPU, and a `CanvasGradient` is tied to absolute coordinates so it can't be reused across positions.

The fix is a **sprite atlas**: render each distinct star once into a small offscreen `<canvas>`, then `drawImage` it at each star's position. A radial-gradient blob is expensive to _build_ but trivial to _blit_.

The key is realising the sprite's shape is a pure function of a few quantised inputs — `(magnitude, B-V colour)` once the zoom scale and magnitude limit are fixed. So:

- Quantise `(mag, bv)` to a bucket key (0.25-mag, ~1/12 B-V steps) → a few hundred distinct sprites cover the whole field.
- Cache them in a `Map<bucketKey, sprite>`.
- Per star, blit the cached sprite. Steady-state cost becomes one `drawImage` (424 ms total) instead of ~15 `addColorStop` + a gradient alloc + `fillRect`.

> **Pattern:** _build once, blit many._ When a draw primitive is costly to construct but you draw many near-identical copies, pre-render to an offscreen canvas keyed by the quantised parameters that define its appearance. Quantising is what makes the cache hit rate high enough to matter.

A useful side-effect: factoring the draw into `computeStarPaint(...)` (pure, returns the resolved scalars) + `paintStar(ctx, x, y, paint)` made the same code serve both the sprite builder and the rare live-drawn highlighted star, so the cached and uncached paths can't visually drift.

---

## Technique 3 — Throttle and coalesce event-driven work

Hover hit-testing (find the star/DSO under the cursor, which also rebuilds the DSO selection) ran **synchronously on every `mousemove`**. The OS delivers mousemoves faster than the display refreshes, so most of that work was thrown away before the next paint.

Two cheap guards:

- **Coalesce to one per frame.** Store the latest cursor position; run the hit-test at most once per `requestAnimationFrame`. You can't show a tooltip faster than you can paint it, so extra calls are pure waste. (Same pattern the renderer already used to collapse redraw requests into one per frame.)
- **Skip during gestures.** While the map is actively panning/zooming (`interacting` flag), don't hit-test at all — the object under the cursor changes every frame and the user isn't reading a tooltip yet. This also closed a gap where hover ran _during_ the most expensive frames.

> **Pattern:** high-frequency input events (mousemove, wheel, resize, scroll) should drive a _request_, not the work itself. Coalesce to the frame rate, and suppress work that's meaningless mid-gesture.

---

## Technique 4 — Cache invalidation: bucketing, freezing, and the time-throttle trap

The sprite atlas (Technique 2) introduced a new failure mode worth dwelling on, because the fix is instructive.

### The problem: a per-frame cache key that changes every frame

The atlas was keyed on `(scale, magLimit)`. Both change _continuously_ during a zoom, so the atlas was cleared and **fully rebuilt every zoom frame** — allocating hundreds of offscreen canvases per frame and driving GC to 13% of CPU. A trace taken during zooming showed `buildStarSprite` at 30% of active CPU. **A cache whose key changes as fast as the thing it caches is not a cache.**

### Fix part 1 — quantise the key (bucketing)

Snap the atlas's scale to a ~6% multiplicative grid (`atlasScaleBucket`) and the magnitude limit to 0.1, and use _those_ as the rebuild trigger and for sprite construction. Sub-bucket jitter (and pan, where scale is constant) no longer invalidates anything; sprites end up at most ~3% off their exact size, which is imperceptible. The bucketing function must be **idempotent** — `bucket(bucket(x)) === bucket(x)` — or you rebuild every frame anyway.

Bucketing alone wasn't enough: a _fast_ zoom changes scale by more than one bucket per frame, so every frame still landed in a new bucket.

### Fix part 2 — freeze during the gesture, scale with `drawImage`

The expensive thing is _building_ sprites, not drawing them. So during a gesture, **don't rebuild** — keep the existing atlas and scale each sprite to the live zoom via `drawImage` (cheap GPU scaling), rebuilding a crisp atlas only when motion settles. Pan and at-rest still draw 1:1 (crisp); only true zoom uses scaled blits. This took zoom from 84 ms → ~24 ms/frame and canvas allocations from ~33k → ~430 over a zoom session.

### Fix part 3 — refresh on _drift_, not on a timer

Freezing the whole gesture made fast zooms **pixelated**: a sprite built at low zoom got upscaled by an unbounded factor (3–5×) and went blocky. It needs to refresh _sometimes_ mid-gesture.

The intuitive fix — "rebuild at most every 100 ms" — **does not work**, and the reason is a good lesson:

> A rebuild frame costs ~60 ms. With a 50–100 ms time floor, the rebuild itself pushes the _next_ frame's elapsed time past the floor, which triggers another rebuild → a feedback loop that rebuilds nearly every frame. **Time-throttling work whose cost is comparable to the throttle interval creates a feedback loop.**

The robust fix throttles by **scale drift** instead of time. Rebuild when the live zoom has drifted past a ratio (`1.3×`) from the frozen atlas:

```ts
const liveRatio = Math.sqrt(view.scale / this.starSpriteScale); // = the drawImage upscale factor
const drifted = liveRatio > 1.3 || liveRatio < 1 / 1.3;
if (atlasStale && (!this.interacting || atlasEmpty || drifted)) rebuild();
```

This is **self-limiting**: each rebuild resets the drift to ~1, so a continuous zoom rebuilds once per ~1.3× step regardless of frame rate — no feedback loop. And because the rebuild decision runs _before_ the `spriteScale` used to draw is computed, any frame that would need >1.3× upscale rebuilds first and draws crisp — so the pixelation is **mathematically bounded to 1.3×**, not just "usually fine."

> **Pattern:** throttle by the quantity you actually care about bounding. Here the user-visible quantity is _upscale blur_, so throttle on the scale ratio, which bounds blur directly and sidesteps the timing feedback loop entirely.

### Addendum — glow halos need a tighter bound than 1.3x

The 1.3x drift bound (Fix part 3 above) is imperceptible on small solid-color star
dots but visibly blurs the larger, soft radial-gradient glow halos bright stars
get (computeStarPaint's glowR, several times the dot radius). Rather than tighten
the global drift ratio (which would rebuild the atlas more often for all stars,
most of which don't need it), glow-eligible stars (mag < theme.glowThresholdMag,
~321 stars catalog-wide) are drawn live at the true zoom scale during the drift
window instead of being blitted from the frozen/scaled atlas — the same "live
draw, bypass the atlas" treatment already used for the single highlighted star.
Gated on `frozenScale` (false at rest/pan), so the extra cost is paid only during the
exact frames where the artifact would otherwise be visible, on a population 1.5-2
orders of magnitude smaller than the one that motivated the atlas in the first
place (Technique 2).

---

## Technique 5 — Cull work before you do it (and know when to stop)

`selectRenderedDSOs` linearly scanned all ~14k DSOs every frame to decide which fall in the viewport. The fix is a spatial cull: index every DSO by its projection position (generation-keyed, so rebuilt only on hemisphere/mode/override change — Technique 1 again), and per frame query only the cells near the viewport. The query radius is the viewport half-diagonal plus a margin for object size.

Two details made it correct and effective:

- **Don't let outliers set the margin.** The margin must cover an object whose _centre_ is off-screen but whose _body_ reaches in. A handful of giant DSOs (Barnard's Loop, big molecular clouds) would force a margin so wide it pulled in most of the catalog — defeating the cull. Solution: objects larger than a threshold (~0.04 projection units) bypass the index into a small always-considered list (~36 objects), so the spatial margin stays tight for the other 99%. Per-frame iteration then drops from ~14k to ~3,900 at 4× zoom, ~250 at 17×, ~60 at 70× — **viewport-bounded, not O(catalog)**.
- **Sort only if you need order.** `findAll` sorts by distance; viewport culling doesn't care about order, so it uses a sort-free `collect`.

> **The honest result.** A clean A/B (cull vs full scan, identical scripted pan) showed **frame time unchanged — 52.0 vs 51.6 ms, within noise.** The trace had already said DSO selection was only ~3% of CPU; the frame is bottlenecked on star drawing and native canvas/raster overhead. So this is a real **CPU-work and scalability** win (per-frame cost stops growing with the catalog) — but **not** an FPS win, because it wasn't the bottleneck.
>
> **Pattern / when to stop.** Once the profile is _flat_ — top items are irreducible drawing plus `(program)`/`(garbage collector)` native overhead, with no single function dominating — you've hit diminishing returns. Further "optimisations" the profile lists at low single-digit percentages will measure as noise. The right move is to A/B them honestly and report that they don't move frame time, rather than shipping complexity for an imagined win. Keep such a change only for a secondary reason (scalability, battery, correctness), and say so.

### Addendum — cap a scale-derived query radius at the drawable region

Technique 5's "viewport-bounded, not O(catalog)" claim is true for the object _count_ it
returns, but it quietly assumed the _cell scan_ was cheap. It isn't. `SpatialIndex.collect`
loops every cell in the query box `[center ± queryR]²`, so its cost is
`O((queryR / cellSize)²)` in **cell lookups** — mostly on _empty_ cells — independent of how
many items it finds.

The query radius is the viewport half-diagonal in projection units, `queryR ∝ 1 / scale`.
Zooming _in_ shrinks it (the intended win); zooming _out_ grows it without bound. A
zoom-out trace showed the damage starkly — `collect` at **~75–79 % of active CPU**, one
function, with GC churn from the throwaway `"${cx},${cy}"` key strings. With
`cellSize = 0.02` and `queryR ≈ 145`, that's ~14 500 × 14 500 ≈ **2×10⁸ cell lookups per
call**, ~6 s _per frame_. The old code comment called this "a no-op cost when zoomed out" —
exactly backwards; it is the _most_ expensive case, and counter-intuitively the frame
collapses precisely when _less_ is on screen.

**The false start worth remembering.** The intuitive fix — "the data is bounded, so clamp
the scan to the index's populated cell bounds" — _does not work here_, and measuring
honestly is what caught it. In the stereographic projection `r = tan((90 − dec)/2)`, so
far-hemisphere objects project to **huge radii** (dec −89° → r ≈ 114; a full-sphere catalog
reaches ~300+ projection units). `ensureDsoAllIndex` inserts _every_ non-giant DSO, so the
index's populated bounds are ~±300, not ±2 — clamping the loop to them removes nothing for a
`queryR ≈ 145` query. A first microbenchmark that placed all points within radius ≲ 2 hid
this and _looked_ like a 6914× win; a second benchmark with points spread over the whole
sphere (matching the real projection) showed the clamp doing nothing. **If a fix's benchmark
doesn't reproduce the real data distribution, it isn't measuring the fix.**

**The real fix — cap the radius at the drawable region** (`sky-map.ts`,
`selectRenderedDSOs`). Every DSO that can actually be drawn lies within the border radius of
the projection _origin_: anything past it is unconditionally culled by the dec pre-filter
(and projects far away anyway). By the triangle inequality, all drawable objects sit within
`hypot(viewCentre) + borderRadiusPU(borderLatDeg + 2)` of the query centre, so

```ts
const queryR = Math.min(viewportRadius /* ∝ 1/scale */, capR);
```

never drops a drawable object yet stays bounded (~2.5 projection units) no matter how far
out you zoom. `borderRadiusPU` returns 1.0 in fisheye/zenith (far side clipped), so it is
mode-correct; it is read live each frame, so a `borderLatDeg` change (which does _not_ bump
the projection generation) can't leave it stale.

**A/B (faithful `collect` microbenchmark — 12k DSOs spread over the whole sphere so far
objects reach ~322 units, cellSize 0.02, zoomed far out):**

| query radius           |    time | notes                                      |
| ---------------------- | ------: | ------------------------------------------ |
| raw `queryR ≈ 145`     | 6494 ms | one call — the frozen frame                |
| capped `queryR ≈ 2.58` |  5.9 ms | **1099×**; drops **zero** drawable objects |

Zoomed-in behaviour is untouched (`Math.min` picks the small viewport radius there). The
per-candidate loop that runs _after_ the query (~10k near-hemisphere candidates when fully
zoomed out, then thinned by the priority budget) becomes the next item in the profile — an
order of magnitude smaller and always present, not a new regression.

> **Pattern.** A query radius derived from zoom/scale (`1/scale`, viewport size) can grow
> unboundedly and turn a "cull" into the hottest function in the trace. Bounding the _index_
> by its data only helps if the data is actually compact — verify that with a
> distribution-faithful benchmark. When the projection scatters culled objects to large
> coordinates, bound the _query_ instead: cap it at the region that can actually be drawn.

The `spatial-index.ts` query loops also clamp to the index's populated cell bounds — a cheap,
general safety net (and a real win for any _compactly_-populated index, e.g. the hover
hit-test indices) — but it is the query cap above, not the clamp, that fixes this symptom.

---

## Results

Measured on identical scripted interactions at above-average density (median `requestAnimationFrame` delta):

| Interaction               | Before      | After                        |
| ------------------------- | ----------- | ---------------------------- |
| Pan                       | 64 ms/frame | **35 ms/frame** (~16→28 fps) |
| Zoom                      | 84 ms/frame | **24 ms/frame**              |
| Zoom — canvas allocations | ~33,000     | **~430**                     |

Per-function self time (% of active CPU), original vs final trace:

| Function                       | Before            | After           |
| ------------------------------ | ----------------- | --------------- |
| `project`                      | 323 ms (8%)       | 27 ms (0.4%)    |
| `addColorStop`                 | 339 ms (9%)       | 137 ms (2%)     |
| `getDSOCatalog`                | 48 ms             | 0 (precomputed) |
| `angularSizeToCanvasPx`        | 54 ms             | 23 ms           |
| `buildStarSprite` (incl, zoom) | 30% of active CPU | 3.5%            |

The spatial DSO cull (Technique 5) reduced per-frame DSO iteration up to ~200× when zoomed in but did **not** change frame time (it wasn't the bottleneck) — kept for scalability, not FPS.

---

## Checklist for a per-frame canvas loop

1. **Profile first.** Read a real CPU trace; rank by self time as a % of _active_ (non-idle) CPU.
2. **Hoist invariants.** Anything in the loop that doesn't change with the frame's camera (pan/zoom) should be cached — by generation counter (slow-changing global state), precomputed at load (immutable per-object), or memoised per-object (slow-changing factors).
3. **Build once, blit many.** Pre-render costly-to-construct primitives to offscreen canvases keyed by their quantised appearance parameters.
4. **Coalesce input.** High-frequency events request work; the frame loop does it. Skip work that's meaningless mid-gesture.
5. **Check your cache key cadence.** If the key changes as fast as the cached value, it's not a cache. Quantise the key; freeze during gestures; refresh on a bounded _drift_, never on a bare timer whose interval is near the work's cost.
6. **A/B every claim.** Stash, run the identical scripted interaction, restore, run again. Watch hidden costs (allocations, GC), not just frame time.
7. **Keep render and hit-test on one code path.** If you cache a value for drawing, the hit-test must consume the same value/formula or clicks will miss what you see.
8. **Know when to stop.** When the profile is flat (irreducible drawing + native overhead on top, nothing dominating), low-percentage items will measure as noise. A/B them honestly; ship only the ones that move the needle, or keep one for a stated secondary reason (scalability, battery, correctness).
