# Feature Ideas — Backlog

A running list of possible features and improvements for MyAstroSky. Not committed work — a menu to
pick from. Each item notes rough **value** and **effort** (S/M/L) and the main files it would touch.

> Top picks (best value-to-effort, build on existing machinery): **A1**, **A3**, **B3+D6**, **C2**, **B1**.

---

## A. Planning & recommender

- [ ] **A1 — Moon awareness** _(value: high, effort: M)_ — moon phase, altitude, and angular
  separation per target; "moon impact" badge, optional score penalty + min-separation filter
  (narrowband penalized less). Reuses sun/twilight altitude code. → `src/astro-time.ts`,
  `src/sky-geometry.ts`, `src/target-recommender.ts`, `src/targets-view.ts`
- [ ] **A2 — Session / "tonight plan" planner** _(value: high, effort: M-L)_ — let the user pick a
  set of targets (from recommender / search) into a persistent "tonight plan"; show them in a
  transit-ordered list with an altitude timeline; export to text/CSV. Foundation that A3 builds on.
  Builds on existing altitude sampling + twilight window. → `src/target-recommender.ts`, new panel
- [ ] **A3 — Per-target framing & rotation** _(value: high, effort: M, depends on A2)_ — extend the
  existing FOV frame so each chosen target in the tonight plan spawns its own **anchored** frame
  (small pin icon to attach/detach a frame from a DSO), each **rotatable individually**, with a
  **camera position-angle (°E of N) readout** to dial into the rotator/mount. Per-target rotation
  syncs back into the tonight list. → `src/fov-overlay.ts`, `src/sky-map.ts`, `src/projection.ts`
- [ ] **A6 — Multi-night projects** _(value: high, effort: M)_ — track active targets with
  integration goals ("M31 — 8h / 20h"), accumulate from linked photos. Overlaps with B1/B2.
- [ ] **A4 — Mosaic planner** _(value: high, effort: L)_ — N×M panel grid with overlap % for
  oversized targets; tiles on map + total integration estimate. Extends A3 + `imaging-recipe.ts`.
- [ ] **A5 — Weather / cloud / seeing** _(value: med-high, effort: M)_ — forecast for the site
  (Open-Meteo / 7Timer!), clear-sky outlook for the planned night. New backend proxy route (mirror
  `version/latest` pattern). → `server/index.ts`
- [ ] **A7 — "Visible right now" / live mode** _(value: med, effort: S)_ — highlight what's
  well-placed this hour. Trivial slice of A2.
- [ ] **D5 — Geolocation fallback fix** _(value: low-med, effort: S)_ — longitude-aware night window
  at extreme UTC offsets (documented constraint). → `src/target-recommender.ts`

## B. Photo & data management

- [ ] **B3 — Deep FITS/EXIF parse on upload** _(value: high, effort: M)_ — capture exposure,
  gain/ISO, temperature, filter, camera, scope, dateObs to auto-fill metadata. Follow
  `add-photo-metadata` skill. → `server/wcs-reader.ts`
- [ ] **B1 — Observation log / journal** _(value: high, effort: M-L)_ — first-class "session" entity
  (date, site, gear, conditions, notes) that photos attach to; turns gallery into a logbook.
  Structural addition. → `server/db-migrations.ts`, gallery, export
- [ ] **B5 — Annotation layer on photos** _(value: high, effort: M)_ — auto-label catalogued DSOs/
  stars that fall inside a solved frame (from WCS + DSO catalog). → `src/dso-catalog.ts`, overlay
- [ ] **B2 — Integration statistics dashboard** _(value: med-high, effort: M)_ — totals by target/
  filter/gear/month; charts. Pure aggregation over existing `integrations[]` + `observationDate`.
- [ ] **B4 — Auto-link photo → gear** _(value: med, effort: M)_ — match FITS header camera/scope to
  the gear catalog. Depends on B3. → fuzzy match vs `resources/*.json`
- [ ] **B6 — Before/after & revision compare** _(value: med, effort: M)_ — multiple versions of a
  target, slider/side-by-side compare. Gallery extension.
- [ ] **B7 — Smart collections / saved filters** _(value: med, effort: S-M)_ — auto-groups and saved
  search queries over existing labels/types.

## C. Sharing & community

> Any outbound/sharing feature should be **opt-in with a clear privacy notice** (mirrors the existing
> ip-api.com warning). C1/C2 are local-only and safe; C3/C4 need explicit consent flows.

- [ ] **C2 — Shareable annotated photo card** _(value: high, effort: M, local-only)_ — single
  annotated image: photo + DSO labels + gear + integration + date, for social posting. Builds on B5.
- [ ] **C1 — Export map/gallery as image or PDF** _(value: high, effort: M)_ — high-res render of the
  current map view (with overlays) or a gallery contact sheet to PNG/PDF.
- [ ] **C3 — Read-only shared link / static export** _(value: med-high, effort: L)_ — self-contained
  static HTML bundle of selected photos placed on the map; hostable or offline. Reuses export infra.
- [ ] **C4 — Optional cloud sync / backup** _(value: med, effort: L)_ — push export bundle to a
  user-supplied destination (S3-compatible / Drive). Opt-in, local-first.

## D. Polish & platform

- [ ] **D2 — Touch / mobile sky-map controls** _(value: med-high, effort: M)_ — pinch-zoom,
  touch-drag, responsive panels. → `src/sky-map.ts`
- [ ] **D6 — astrometry.net WCS post-fetch** _(value: med, effort: S-M)_ — fetch WCS file after solve
  to fill dateObs/expTime (closes documented pre-fill gap). Pairs with B3. → `server/astrometry.ts`
- [ ] **D1 — Split `server/index.ts`** _(value: med/maintainability, effort: M)_ — break ~3k-line
  file into route modules (photos, solve, gear, settings, export). Keep Swagger annotations.
- [ ] **D3 — Offline tiles / PWA** _(value: med, effort: M)_ — catalog data is already static JSON.
- [ ] **D4 — Accessibility pass** _(value: med, effort: M)_ — keyboard nav, ARIA on modals, contrast
  tokens (see `docs/dev/ui-guidelines.md`).

---

## Definition of done (any item)

- Use the matching skill: `frontend-feature` / `fullstack-feature` / `add-photo-metadata`.
- Add/update unit tests in `tests/unit/` (Vitest hook runs on every `.ts` edit).
- `npm run build` passes (tsc + vite).
- Browser-verify with Playwright MCP (`npm run dev` → `localhost:5173`), check console, test FR + EN.
- i18n keys in all four locales (`src/i18n/{fr,en,es,de}.ts`).

---

# Details

Expanded explanation of each item — enough to understand the *what* and *why* without a full spec.

## A. Planning & recommender

**A1 — Moon awareness.** The recommender currently scores targets on altitude, FOV fit, and
brightness, but ignores the Moon — which in practice is the single biggest factor in whether a given
night is usable for a given target. The Moon washes out faint broadband (LRGB) targets when it's
bright and near them in the sky, while narrowband (Ha/OIII/SII) shrugs it off. This adds a lunar
position calculation (phase %, altitude, and angular separation from each target) and surfaces it as
a "moon impact" badge on each card, with an optional score penalty and a minimum-separation filter.
The penalty would be softened for narrowband-suited targets. The math reuses the same altitude/time
machinery already powering the sun/twilight calculation.

**A3 — Per-target framing & rotation.** _Builds on A2 (the tonight plan) and on the FOV-frame
feature that already exists._ Today the app can draw a gear FOV rectangle and rotate it, but the
frame is anchored to the centre of the viewport (you pan a target under it), there's only one global
rotation shared by all frames, and the rotation shown is screen-relative — not the angle you'd
actually set at the scope. This item closes those gaps:

- **Anchoring** — a small **pin icon** on a frame attaches it to a specific DSO so it stays put on
  that object instead of the viewport centre (and can be un-pinned to free-float again).
- **Per-target frames** — every target the user adds to the **tonight plan (A2)** spawns its own
  anchored frame, so you can see how each object composes in one view.
- **Independent rotation** — each frame rotates on its own (not one global angle), so you can tilt
  each composition separately. Changing a frame's rotation **writes back into the tonight list** so
  the plan records the chosen angle per target.
- **Position-angle readout** — convert the on-screen frame rotation (plus the map rotation) into a
  true celestial **position angle (°E of N)**, the number you dial into a rotator/mount to reproduce
  the framing at the telescope. This is the piece that turns the preview into an actionable plan.

A2 is the prerequisite: the set of chosen targets is what drives which anchored frames exist. → `src/fov-overlay.ts`, `src/sky-map.ts`, `src/projection.ts`

**A2 — Session / "tonight plan" planner.** Today you get a flat list of good targets but no way to
*commit* to a subset for a given night. This adds the notion of a **tonight plan**: the user picks
targets (from the recommender or search) into a persistent list, ordered by when they transit (cross
the meridian, their best moment), with a simple timeline showing when each rises above the altitude
floor and when it peaks — so you can sequence a night without overlap. Exportable to text/CSV to
bring to the scope. All the underlying altitude-over-time sampling already exists in the recommender;
this is a new presentation plus a selection/persistence layer. It's also the **foundation for A3** —
the chosen targets are what spawn the anchored framing rectangles, and per-target camera angles set
in A3 are recorded back here.

**A6 — Multi-night projects.** Serious targets take many nights to accumulate enough signal. This
adds the notion of an active "project" with an integration goal (e.g. "M31 — 8 h collected / 20 h
goal"), automatically summing exposure from photos linked to that target via their existing
`integrations[]` metadata, and showing progress. It's the bridge between "I planned this" and "I'm
actively collecting this." Overlaps naturally with the observation log (B1) and stats (B2).

**A4 — Mosaic planner.** Some objects (Andromeda, the Veil, large nebulae) are bigger than any single
frame at your focal length. This computes a panel grid (e.g. 2×3) with a configurable overlap
percentage so the tiles stitch cleanly, draws the tiles on the map, and estimates total integration
time across all panels. It's an extension of the framing assistant (A3) plus the imaging-recipe time
math.

**A5 — Weather / cloud / seeing.** Planning is moot if it's cloudy. This pulls an astronomy-oriented
forecast (services like Open-Meteo or 7Timer! expose cloud cover, seeing, and transparency) for the
chosen site and shows a clear-sky outlook for the planned night. It would be a small backend proxy
route following the same pattern already used to check for app updates, with coordinates coming from
the existing geolocation.

**A7 — "Visible right now" / live mode.** A lightweight, instant-gratification slice of the planner:
given the current time, just highlight what's well placed *this hour* for a quick "what should I
point at now" answer. Essentially the planner restricted to "now."

**D5 — Geolocation fallback fix.** (Listed under A because it's a recommender fix.) At extreme
longitudes/UTC offsets, when the twilight calculation can't find a dark window it falls back to a
fixed 20:00–06:00 UTC window, which is wrong for observers far from UTC. This makes that fallback
longitude-aware so the assumed night lines up with the observer's actual local night. Small, isolated
fix to a documented constraint.

## B. Photo & data management

**B3 — Deep FITS/EXIF parse on upload.** Astrophotos carry rich metadata in their headers —
exposure time, gain/ISO, sensor temperature, filter, camera and telescope names, capture date. Today
most of this must be entered by hand. This reads those headers on upload and auto-fills the photo's
metadata, removing daily friction. It also closes a known gap where astrometry.net solves don't
capture capture-date/exposure. Follow the `add-photo-metadata` skill since it touches the DB, editors,
and export.

**B1 — Observation log / journal.** Right now photos are the top-level entity, but the natural unit of
amateur astronomy is the *session*: "the night of June 3rd, from my backyard, with this rig, under
these conditions." This adds a first-class session record (date, site, gear, sky conditions, notes)
that photos attach to, turning the gallery into a logbook. It's the most structural addition here and
the foundation that makes stats (B2), projects (A6), and richer sharing more powerful.

**B5 — Annotation layer on photos.** Once a photo is plate-solved, the app knows exactly which patch
of sky it covers — so it knows which catalogued objects fall inside the frame. This overlays their
labels directly on the displayed photo (e.g. marking every NGC/IC galaxy in a wide-field shot),
computed automatically from the solved WCS and the DSO catalog. Great for identification and the
basis for the shareable card (C2).

**B2 — Integration statistics dashboard.** A "year in review" for your imaging: total exposure hours,
number of nights out, most-imaged targets, breakdowns by filter / gear / month, with charts. It's
pure aggregation over data the app already stores (`integrations[]` and observation dates), so it can
be largely frontend-only.

**B4 — Auto-link photo → gear.** Building on the deep header parse (B3), match the camera and
telescope names found in a photo's headers against the 1000+ entry gear catalog, so each photo
automatically knows what equipment shot it — feeding stats and project tracking without manual
tagging.

**B6 — Before/after & revision compare.** Reprocessing is a big part of the hobby. This lets you keep
multiple versions of the same target and compare them side-by-side or with a slider, to see
processing or acquisition improvements over time. A gallery extension.

**B7 — Smart collections / saved filters.** Auto-generated groupings ("Galaxies," "Narrowband,"
"2026") and the ability to save a search/filter as a reusable collection, so you can navigate a large
library by theme rather than scrolling. Built over the labels and types already present.

## C. Sharing & community

> Anything that sends data outward should be opt-in with a clear privacy notice, matching the app's
> existing posture (the IP-geolocation feature is already gated behind a warning). C1/C2 are
> local-only and carry no privacy risk; C3/C4 involve outbound data and need explicit consent.

**C2 — Shareable annotated photo card.** A one-click, social-ready image: your photo with its
in-frame DSO labels (from B5), plus a caption strip showing the gear used, total integration, and
date. The kind of thing people post to forums and social media. Fully local — it renders an image,
nothing leaves the machine. High delight, low risk.

**C1 — Export map/gallery as image or PDF.** Render the current sky-map view (with your photos placed
on it) as a high-resolution PNG, or lay the gallery out as a printable "contact sheet" PDF. Useful
for sharing a season's work or printing a personal poster. The canvas already draws the map; this
adds a high-res offscreen render and a gallery-to-PDF layout.

**C3 — Read-only shared link / static export.** Generate a self-contained static HTML bundle of
selected photos placed on the map — no server required to view it. You could host it on any static
site or open it offline to show someone your placed collection interactively. Reuses the existing
export bundling, plus a small static-site generator.

**C4 — Optional cloud sync / backup.** Push the existing export bundle to a user-supplied destination
(an S3-compatible bucket, Google Drive, etc.) for backup or syncing between machines. Strictly
opt-in and local-first — the app never assumes a cloud account. Larger effort and the one item that
most needs a careful consent flow.

## D. Polish & platform

**D2 — Touch / mobile sky-map controls.** The sky map is mouse-centric (drag to pan, wheel to zoom).
This adds pinch-to-zoom and touch-drag and makes the side panels responsive, so the web build is
usable on a phone or tablet — handy in the field. Concentrated in the canvas event handling.

**D6 — astrometry.net WCS post-fetch.** When you solve online via astrometry.net, the solver produces
a WCS file with header fields (like capture date and exposure) that the current integration doesn't
pull back. This fetches that file after a successful solve to fill in those fields. Small, and pairs
naturally with the deep-header work in B3.

**D1 — Split `server/index.ts`.** The backend is a single ~3,000-line file with ~51 routes (already
flagged as design debt). Splitting it into focused route modules (photos, solving, gear, settings,
export) makes the code easier to navigate and safer to change. Pure refactor with no behavior change —
must preserve the Swagger annotations on every route.

**D3 — Offline / PWA (web build only).** *Scope clarification: the Electron desktop build is already
fully offline, and the catalog files are already static — so this is purely about the browser-hosted
deployment.* Turning the web app into a PWA (service worker + manifest) would cache the app shell and
the static catalog/star JSON in the browser, so the map, search, and catalog browsing keep working
with no network and load instantly on repeat visits. The `/api` features (upload, solving) still need
the server, so it's partial offline. **Low priority given the desktop app already covers offline
use** — only worth it if offline browser use is a real goal.

**D4 — Accessibility pass.** Keyboard navigation, ARIA labelling on modals and controls, and
contrast-checked color tokens, so the app is usable with assistive tech and meets basic accessibility
expectations. The design-token groundwork already exists in the UI guidelines.
