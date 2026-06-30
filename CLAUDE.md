# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Skills

Project-specific skills live in `.claude/skills/`. The harness auto-invokes them on matching trigger phrases.

| Skill | When to invoke |
|---|---|
| `frontend-feature` | Adding or changing purely frontend UI (panels, modals, widgets, CSS) |
| `fullstack-feature` | Adding or changing API routes together with frontend UI |
| `add-photo-metadata` | Adding a new optional field to photo metadata (DB, all 3 UI editors, export/import, WCS/astrometry pre-fill) |
| `add-dso-catalog` | Integrating a new DSO catalog (RCW, Barnard, Abell…) |
| `override-dso-metadata` | Correcting DSO names, types, coordinates, or ratings in the static catalog |
| `test-placement` | Testing astrophoto upload, plate solving, and sky-map placement |
| `profile-performance` | Profiling a perf trace / janky pan-zoom: parse a CPU trace into hot functions, pick an optimisation, A/B benchmark |

---

## Development Commands

```bash
npm run dev          # Runs Vite (port 5173) + Express (port 3001) via concurrently
npm run dev:client   # Vite frontend only
npm run dev:server   # Express server with tsx watch (hot reload)
npm run build        # tsc type-check + vite build to dist/
npm run preview      # Preview production build
npm test             # Run unit test suite (Vitest)
npm run test:watch   # Vitest in watch mode
npm run test:coverage  # Coverage report (v8)
npx vitest run tests/unit/<file>.test.ts  # Run a single test file
npm run swagger:generate  # Regenerate public/swagger.json from JSDoc annotations
npm run electron:make     # Package desktop app (runs clean + build + electron-forge make)
```

### DSO catalog regeneration

After editing `scripts/dso-metadata-overrides.json` or `scripts/generate-dso.mjs`:

```bash
npm run dso:generate   # Rebuilds public/data/dso.json + recomputes constellations
```

After changing rating/difficulty/containment/priority logic in `scripts/add-ratings.mjs`, strip and rebuild those derived columns (the script recomputes all four together):

```bash
node -e "
const fs = require('fs'), path = 'public/data/dso.json';
const d = JSON.parse(fs.readFileSync(path,'utf8'));
const DERIVED = ['rating','difficulty','containerId','priority'];
const toRemove = DERIVED.map(f=>d.fields.indexOf(f)).filter(i=>i>=0).sort((a,b)=>b-a);
d.fields = d.fields.filter(f=>!DERIVED.includes(f));
d.data = d.data.map(r=>{const a=[...r];toRemove.forEach(i=>a.splice(i,1));return a;});
fs.writeFileSync(path,JSON.stringify(d));
"
node scripts/add-ratings.mjs
```

No linter is configured.

## Unit Tests

The test suite uses **Vitest 3** + **happy-dom**. Tests live under `tests/` (mainly `tests/unit/`, plus `tests/components/`). Run with `npm test`. To count the test files: `git ls-files 'tests/**/*.test.ts' | wc -l`.

### Testing rule

Before finishing any edit to a `.ts` file in `src/` or `server/`, check `tests/unit/` for a matching test file (e.g. editing `src/affine.ts` → look for `tests/unit/affine.test.ts`). Update or add tests for any changed or new logic. Skip files explicitly excluded in `vitest.config.ts` — they are listed there with comments explaining why (DOM-only, fetch-only, entry points).

A PostToolUse hook (`.claude/hooks/vitest-on-ts-edit.js`) runs `npx vitest run` automatically after any Edit or Write to `src/**/*.ts` or `server/**/*.ts`, so regressions surface immediately.

Fixtures in `tests/fixtures/`:
- `solve-field/LDN1235.wcs` and `M1_CCD_siril.wcs` — real WCS files from local solve-field runs
- `astrometry/10796000-*.json` and `10796000-wcs.fits` — real data from nova.astrometry.net job 10796000 (M13 field)
- `stars.test.json` — minimal 6-star catalog for deterministic WCS tests

CI runs the full suite on every push/PR via `.github/workflows/test.yml` (Node.js 24).

## Browser Testing

**Every code change must be verified in the browser before considering it done.** Use the Playwright MCP tools to test visually and interactively.

### Workflow

1. Start the dev server with `npm run dev` (runs Vite on port 5173 + Express on port 3001).
2. Navigate to `http://localhost:5173` using `browser_navigate`.
3. Take a snapshot (`browser_snapshot`) or screenshot (`browser_take_screenshot`) to verify the UI state.
4. Interact with the app (click, type, etc.) to test the modified feature.
5. Check the browser console (`browser_console_messages`) for errors or warnings.
6. **Fix any bug found during testing**, even if unrelated to the current task.

### What to verify

- No console errors or unhandled exceptions.
- UI renders correctly (layout, text, translations).
- Interactive features work (buttons, modals, search, canvas pan/zoom).
- Photos display and transform correctly on the sky map.
- Gallery mode displays photos correctly in grid, navigates to map on click.
- View mode toggle switches between Map and Gallery smoothly.
- Repositioning feature works (extracts current state, allows editing, saves new state).
- Smart sorting works in both photo list and gallery (M1, M8, M31, M100, M101...).
- Targets tab: gear preset selection, location, date, filters, Best/Random buttons, pagination.
- Both FR and EN languages render properly if i18n was touched.

## Documentation architecture

This repository has two doc audiences with separate folders. **Never mix them.**

| File | Audience | Owns |
|---|---|---|
| `docs/user/user-guide.md` | Astronomers / end users | Features, UI, plate solving methods, solver installation, how to access the running app |
| `docs/dev/architecture.md` | Developers | Module descriptions (frontend + backend), data flows, key types |
| `docs/dev/dso-catalog.md` | Developers | SIMBAD validation, known OpenNGC data quality issues, rating/difficulty field docs |
| `docs/dev/distribution.md` | Developers / maintainers | All deployment options (dev, prod, Docker, LAN), Electron packaging plan, platform solver matrix |
| `docs/dev/solve-field-placement.md` | Developers | Y-axis convention, EXIF orientation correction, plate solving diagnostic checklist |
| `docs/dev/ui-guidelines.md` | Developers | CSS colour tokens, typography, component class inventory, known CSS issues |
| `docs/dev/curved-arrow-svg.md` | Developers | Math for constructing tangent-aligned arrowheads on circular-arc SVG arrows |
| `docs/dev/imaging-recipe.md` | Developers | Integration time algorithm, filter selection logic, type-family constants, tuning guide |
| `docs/dev/target-recommender.md` | Developers | Target recommender pipeline: filters, scoring formula, diversity cap, altitude preferences, known constraints |
| `docs/dev/render-performance.md` | Developers | Transferable canvas-perf techniques from the sky-map render loop: profiling, hoisting per-frame invariants, sprite atlas, input coalescing, cache-key bucketing/drift |
| `docs/dev/ci.md` | Developers | GitHub Actions workflows: CI, tests, Docker image build/smoke-test, Electron release builds |

**Rules:**
- User-facing content (features, how to use, how to install a solver) → `docs/user/`
- Technical content (implementation, deployment, architecture, build steps) → `docs/dev/`
- `CLAUDE.md` itself holds only AI-agent guidance (commands, conventions, brief pointers) — it does not duplicate the content of the doc files
- Do not create new doc files without updating this table and the Copilot instructions (`.github/copilot-instructions.md`)

---

## Architecture

**MyAstroSky** overlays astrophotographs onto an interactive sky map (HTML5 Canvas, stereographic polar projection). Photos are positioned via CSS `transform: matrix()` from affine registration. A Targets tab recommends DSOs based on gear, location, and sky conditions.

See [docs/dev/architecture.md](docs/dev/architecture.md) for full module descriptions (frontend + backend), data flows, and key types.

See [docs/dev/ui-guidelines.md](docs/dev/ui-guidelines.md) for CSS colour tokens, typography scale, component class inventory, and known CSS issues to address.

See [docs/dev/distribution.md](docs/dev/distribution.md) for deployment options (Docker, Node.js) and the planned Electron desktop packaging.

See [docs/dev/solve-field-placement.md](docs/dev/solve-field-placement.md) for:
- Y-axis convention (`fitsYConvention`) and why it is always `false` for JPEG/PNG input
- EXIF orientation correction (`rawToBrowserCoords`) and the correct formula for each orientation value
- Diagnostic checklist when a newly solved image appears misaligned

## DSO Catalog

`public/data/dso.json` — 12,000+ objects, columnar JSON, 15 fields.

See [docs/dev/dso-catalog.md](docs/dev/dso-catalog.md) for:
- SIMBAD validation workflow and known OpenNGC errors (including the SH2 systematic coordinate drift)
- Rating and difficulty field documentation and regeneration commands

## Conventions

- **UI text is internationalized (FR/EN).** French is the default language. Translations live in `src/i18n/fr.ts` and `src/i18n/en.ts`. Use `t('key')` for all user-facing strings. Constellation/DSO names use `displayName` (populated per-language at load time).
- Vite proxies `/api` and `/uploads` to `http://localhost:3001` during dev.
- Backend reads `PORT` env var (default 3001) and `DB_PATH` (default `./data.db`).
- Uploaded photos go to `uploads/` directory on disk, named with UUIDs.
- `DSO_CATALOGS_ALL` is exported from `dso-catalog.ts` — do not redefine it locally in `ui.ts` or elsewhere.

### Commit messages

Use **[Conventional Commits](https://www.conventionalcommits.org)** — the release changelog is generated by parsing them (`cliff.toml` + git-cliff). Accepted types and their changelog sections:

| Type | Section | Use for |
|---|---|---|
| `feat:` | Features | A brand-new feature/capability |
| `improvement:` | Improvements | An enhancement to an existing feature (custom type) |
| `fix:` | Bug Fixes | A bug fix |
| `perf:` | Performance | A speed/efficiency change with no behavior change |
| `refactor:` | Refactor | Internal restructuring, no observable change |
| `docs:` | Documentation | Docs only |
| `test:` | Testing | Tests only |
| `style:`, `build:` | Styling / Build System | Formatting, build tooling |
| `chore:`, `ci:` | *(hidden)* | Skipped from the changelog |

Append `!` (e.g. `feat!:`) or a `BREAKING CHANGE:` footer for breaking changes. Preview the *unreleased* section (since the last tag) to the console with `npm run changelog:preview`; regenerate the actual files with `npm run changelog` (runs `scripts/generate-changelog.mjs`). `CHANGELOG.md` is scoped to the **current major version series**; completed majors are frozen into `CHANGELOG.v<n>.md` archives automatically at the next major release. See [docs/dev/ci.md](docs/dev/ci.md#release-release-yml) for how the release pipeline consumes commits.

### Before adding CSS

This project uses **UnoCSS** (utility-first, Tailwind-compatible). Agents must follow this checklist or they will create duplicate CSS:

1. **Never use `style=` in Vue templates.** All styling goes through class names.
2. **Check `uno.config.ts` shortcuts first** for an existing named component class (e.g. `btn-action`, `input-base`, `tag-chip`). Use it before inventing a new one.
3. **Use UnoCSS atomic utilities** for spacing, color, flex, layout — `ml-4`, `text-primary`, `flex`, `gap-2`, `w-full`, `hidden`, etc.
4. **Only add to `src/styles/canvas.css`** when the style requires a pseudo-element (`::before`/`::after`), `@keyframes`, a canvas-layer selector, or a `:has()`/sibling combinator that cannot be expressed as a class attribute. Everything else is a UnoCSS class.
5. **New design tokens** go in both `uno.config.ts` theme AND `src/styles/tokens.css` (kept in sync). Never hardcode a color or pixel value directly — always use a CSS variable.
6. **Do not add new rules to `src/style.css`** — it is a legacy file being phased out. All new component styles go to shortcuts or utilities.
