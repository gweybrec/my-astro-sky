---
name: profile-performance
description: >
  Profile and optimise runtime performance — especially the canvas render loop
  (sky-map.ts) during pan/zoom, but applies to any hot path. Use when the app feels
  janky, frames drop, an interaction stutters, or the user provides a Chrome DevTools
  performance trace (Trace-*.json) and asks what's slow. Covers parsing a CPU trace
  into hot functions, locating them in source, choosing an optimisation, and A/B
  benchmarking the fix in the browser.
  Trigger phrases: "profile performance", "what's slow", "analyze trace",
  "performance trace", "it's laggy", "frames drop", "optimize render", "too slow",
  "janky pan", "find heavy functions", "Trace-*.json".
---

# Profile Performance

Find what's actually slow, fix it, and prove the fix with a before/after. **Never optimise from intuition** — measure first, measure after.

Read [`docs/dev/render-performance.md`](../../../docs/dev/render-performance.md) before optimising: it documents the techniques already applied to the render loop (generation-counter caches, the star sprite atlas, input coalescing, cache-key bucketing/drift) so you don't re-derive or undo them.

## Unit tests

This skill is analysis + measurement. If your fix changes a `.ts` file in `src/` or `server/`, the normal testing rule applies — check `tests/unit/` for a matching test and update it. Pure helpers worth testing (cache-equivalence invariants, bucketing idempotence) are described at the end of `docs/dev/render-performance.md`. Canvas/DOM render code stays browser-verified only.

---

## Step 0 — Get a trace

A Chrome DevTools CPU trace is the input. Either:

- **The user records it** (most common): DevTools → Performance → Record → do the slow interaction (e.g. pan/zoom at high star/DSO density) for a few seconds → Stop → save as JSON (the "Save profile…" / download button). They'll point you at a `Trace-*.json` in the repo root.
- **You drive it** via Playwright if you just need frame timings (see Step 4) — lighter weight, no DevTools needed, but no per-function breakdown.

Traces are large (10–40 MB). Don't `Read` them — parse with the script in Step 1.

## Step 1 — Parse the trace into hot functions

Run the bundled parser against the trace. It aggregates the embedded CPU sampling profile (`Profile` + `ProfileChunk` events) by **self time** (where the CPU is) and **inclusive time** (which callers own it), reported as a % of _active_ (non-idle) CPU.

```bash
node .claude/skills/profile-performance/scripts/parse-trace.mjs Trace-XXXX.json
```

Read the top self-time list first — that's where the time goes. Then the inclusive list to see which high-level function (`render`, `renderStars`, …) owns it. Watch for surprises the eye misses: `(garbage collector)` climbing means allocation churn; a canvas builtin like `fillRect`/`createRadialGradient`/`addColorStop` high up means per-element drawing cost.

## Step 2 — Locate the hot functions in source

Trace line numbers come from the **bundled** output (e.g. `sky-map.ts?t=...:2147`), not source — they won't match. Find functions by **name** instead:

```
Grep  pattern="function renderStars|private renderStars|renderDSOs|project\b"  path="src"
```

Then `Read` the function and work out _why_ it's hot.

## Step 3 — Pick the optimisation

Match the symptom to a technique from `docs/dev/render-performance.md`:

| Symptom in the trace                                                                          | Technique                                                                                                                                                      |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A pure transform (`project`, trig) high in self time, called per element per frame            | Cache it; invalidate with a **generation counter** bumped only on the rare state change                                                                        |
| A regex / string parse / lookup per element per frame, on immutable data                      | Precompute **once at load**, store as a field                                                                                                                  |
| A per-element factor that depends only on slow-changing state (dec, hemisphere)               | Memoise per object, invalidate by generation                                                                                                                   |
| Canvas gradient/path builtins (`addColorStop`, `createRadialGradient`, `fillRect`) dominating | **Sprite atlas**: build once to an offscreen canvas keyed by quantised appearance, `drawImage` to blit                                                         |
| Work running per `mousemove`/`wheel`/`resize`                                                 | **Coalesce** to one per `requestAnimationFrame`; **skip** during active gestures                                                                               |
| `(garbage collector)` high + many short-lived objects/canvases                                | Stop allocating in the loop (cache results, freeze caches during gestures)                                                                                     |
| A cache that rebuilds every frame                                                             | Its **key changes too fast** — quantise/bucket it, freeze during gestures, refresh on bounded **drift** not a timer (see the feedback-loop warning in the doc) |

Keep render and hit-test on the **same formula/value** — if you cache something for drawing, the click/hover hit-test must consume the same thing or it will miss what's drawn.

## Step 4 — A/B benchmark the fix (mandatory)

A speedup claim needs a before/after on an **identical scripted interaction**. The benchmark script drives a deterministic pan or zoom via dispatched events and reports median/avg/p95 `requestAnimationFrame` frame time plus canvas-allocation count (which exposes hidden churn that frame time alone hides).

1. Make sure the dev server is up (`http://localhost:5173`; run `npm run dev` in the background if not).
2. With your change **stashed** (baseline), navigate the page and run the benchmark; record the numbers.
   ```bash
   git stash push -- src/sky-map.ts        # or whichever files
   ```
   Reload the page (Vite HMR serves the old code), then run the function in `scripts/benchmark.js` via Playwright `browser_evaluate` (paste its contents as the `function` argument; it returns the metrics).
3. Restore your change, reload, run the same benchmark:
   ```bash
   git stash pop
   ```
4. Compare. Confirm frame time dropped **and** allocations didn't balloon. Verify visually too (`browser_take_screenshot`) and check the console for errors (`browser_console_messages`) — a perf change must not alter the output.

The benchmark function takes a mode: `'pan'` (constant scale, circular drag) or `'zoom'` (continuous wheel in/out). Run both — a fix can help one and hurt the other (the sprite atlas helped pan but first regressed zoom; see the doc).

> Note on Vite HMR timing: after stashing/popping, reload the page and confirm the served code is what you expect before benchmarking — a stale module gives identical before/after numbers. You can sanity-check with `curl -s http://localhost:5173/src/<file>.ts | grep <marker>`.

## Step 5 — Report

Give the before/after table (frame time + allocations), the per-function self-time deltas from the trace, and which technique you applied. Be honest about regressions in the other interaction mode.
