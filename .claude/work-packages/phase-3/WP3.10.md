# WP3.10 — A package for what both apps share above the screens

Model: sonnet · Branch: `mobile/phase-3b` · Depends on: WP3.9 · Needs device: no · Needs browser: no (the orchestrator checks the app in a browser afterwards)

## Goal

The data functions (`src/api.ts`) and the stores that hold data from the backend are needed identically by the phone app. Move them to a new workspace package, `packages/app-state` (`@myastrosky/app-state`), which may use Vue and Pinia but no DOM screen code. The desktop keeps importing the same paths through one-line re-exports. **No behaviour changes.**

## Steps

1. **The package.** `packages/app-state/package.json` (private, `"type": "module"`, `"exports": { "./*": "./src/*.ts" }`, dependencies `@myastrosky/core`, and `vue` and `pinia` as peer dependencies at the root's versions), `tsconfig.json` (`lib: ["ES2022", "DOM"]`, `types: []`, strict, like `packages/backend-http`). Register it everywhere a package is registered: the root `typecheck` script (`typecheck:app-state`), `.github/workflows/ci.yml`, the type-aware parser list and a lint block in `eslint.config.js` (browser globals; `no-restricted-imports` at **error**: only `@myastrosky/core/*`, `vue`, `pinia` and relative paths; nothing from `src/`, `server/`, `@capacitor/*` or the two backend packages), `docs/dev/ci.md`, and a `packages/app-state/CLAUDE.md` of at most ten lines (what goes in: data functions and stores that hold backend data or user data; what stays out: anything that builds or reads the page, `document`, `window` events, a store that only describes the desktop's panels). Add its row to the table of the root `CLAUDE.md`.
2. **The backend holder.** `src/backend.ts` → `packages/app-state/src/backend.ts`: `setBackend`, `getBackend`. It no longer installs a default itself (the package must not import the HTTP backend): `getBackend()` throws a clear error when nothing was set. `src/platform-init.ts` installs the HTTP backend (`setBackend(createHttpBackend({ lang, saveFile }))`), as it already configures the other platform hooks; `src/backend.ts` becomes a re-export. Since `tests/setup/platform.ts` imports `src/platform-init`, tests that use the real `src/api` keep a backend.
3. **The data functions.** `src/api.ts` → `packages/app-state/src/api.ts`. Whatever it imports from `src/` must come from core or from a hook: the i18n functions from `@myastrosky/core/i18n/index`; the error reporter through the core error hook of WP3.9; `fileSource(file)` stays in the package (it uses the DOM `File`, which the package's `lib` allows). `src/api.ts` becomes `export * from '@myastrosky/app-state/api';`. The 15 tests that replace `src/api` with `vi.mock('../../src/api', …)` keep working for modules of `src/` (they import the re-export, which is the mocked module). They no longer intercept a module **inside the package** that imports `./api`: see step 5.
4. **The stores that hold backend data**: `src/stores/plans.ts`, `poi-categories.ts`, `sky-regions.ts`, `settings.ts` → `packages/app-state/src/stores/`, with re-exports at the old paths. They import `./api`-side functions relatively inside the package, and report errors through the core error hook in place of `src/error-reporter`. Do **not** move in this card: `fov-frames`, `horizon`, `sky-time` (each mixes user data with the desktop's canvas; they are split when the phone screen that needs them is built), nor `canvas`, `display`, `fisheye`, `photos`, `shortcuts`, `ui` (desktop screen state).
5. **Tests of the moved stores** (`tests/unit/plans-store.test.ts`, and any test whose module under test is now inside the package and whose `vi.mock('../../src/api')` no longer applies: `fov-frames-store`, `fov-popup`, `frame-delete`, `setup-switch` use the plans store): change the mock's path to `@myastrosky/app-state/api` **in addition to or in place of** the old one, whichever makes both the moved store and the unmoved modules see the mock (when a test needs both, mock both paths with the same factory object). List every edited test with the reason. No assertion changes.
6. **Docs.** `docs/dev/mobile-architecture.md`: the package in the layout and the dependency rules, and in "How a screen reaches its data" the new location of the data functions and of the backend's installation (`platform-init` on the desktop; the phone's own start-up later).

## Must NOT

- Move a screen, a component or a store other than the four named.
- Make the package import from `src/`.
- Change any exported name.

## Escalate if

- `src/api.ts` depends on something of `src/` that is neither in core nor expressible as a hook.
- More tests than those described in step 5 need an edit.

## Commit

`internal(mobile): add the shared app-state package with the data functions and the backend stores`

## Check by the orchestrator, after the commit (browser, isolated data)

As at the end of `WP3.4.md` (ports free or skip; `DB_PATH` and `UPLOADS_DIR` in an empty scratchpad folder; kill only your own process tree): the map draws with no console error; the Targets tab lists targets; create a plan, add a target, rename, delete; create and delete a point-of-interest category in its window; draw nothing else. Screenshots in `.playwright-mcp/phase3b-check/`.

## Report, in addition to the common items

What moved · the hooks `platform-init` now sets · tests edited and why.
