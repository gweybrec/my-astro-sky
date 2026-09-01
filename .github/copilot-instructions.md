# GitHub Copilot Instructions

## Source of truth

**The Claude files are the single source of truth for this repository.**
Copilot instructions and skills must never duplicate knowledge — they always reference the Claude files where the content lives.

| Claude file                                                                                         | What it contains                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`CLAUDE.md`](../CLAUDE.md)                                                                         | Cross-cutting only: dev commands, lint/format, `npm run verify`, architecture overview, DSO catalog pointers, i18n default, commit conventions                                                                                                                         |
| [`src/CLAUDE.md`](../src/CLAUDE.md)                                                                 | Frontend: browser verification workflow + "what to verify", CSS/UnoCSS checklist, ui-verify tiers, i18n specifics, `DSO_CATALOGS_ALL` / smart-telescope conventions                                                                                                    |
| [`server/CLAUDE.md`](../server/CLAUDE.md)                                                           | Backend: `PORT`/`DB_PATH` env vars, `/api` proxy, `GET /api/filters`, `db-migrations.ts`, Swagger JSDoc on every route, backend logging via `server/logger.ts`                                                                                                         |
| [`tests/CLAUDE.md`](../tests/CLAUDE.md)                                                             | The matching-test-file rule, Vitest 3 + happy-dom setup, `tests/fixtures/` inventory, `@vue/test-utils` component-test patterns                                                                                                                                        |
| [`scripts/CLAUDE.md`](../scripts/CLAUDE.md)                                                         | DSO catalog regeneration (`npm run dso:generate`, `add-ratings.mjs` idempotency), filter catalog colour seeding (`npm run filters:seed`)                                                                                                                               |
| [`docs/CLAUDE.md`](../docs/CLAUDE.md)                                                               | The two-audience documentation-file map (user vs dev) and its rules                                                                                                                                                                                                    |
| [`docs/dev/architecture.md`](../docs/dev/architecture.md)                                           | Full frontend/backend module descriptions, data flows, key types                                                                                                                                                                                                       |
| [`docs/dev/dso-catalog.md`](../docs/dev/dso-catalog.md)                                             | SIMBAD validation, known OpenNGC issues, rating/difficulty field docs                                                                                                                                                                                                  |
| [`docs/user/user-guide.md`](../docs/user/user-guide.md)                                             | User manual: features, plate solving, installation, how to access the app                                                                                                                                                                                              |
| [`docs/user/installing-app.md`](../docs/user/installing-app.md)                                     | End-user install paths: desktop app download/install/uninstall, self-hosting via Docker, LAN sharing                                                                                                                                                                   |
| [`docs/dev/distribution.md`](../docs/dev/distribution.md)                                           | Building/running from source, Electron packaging internals, env var & CSP config reference                                                                                                                                                                             |
| [`docs/dev/ui-guidelines.md`](../docs/dev/ui-guidelines.md)                                         | UI hub: CSS architecture + shortcuts, linking to chapters under `docs/dev/ui/` (`tokens.md` colour/spacing/type tokens, `components.md` component catalog, `patterns.md` layout & known issues)                                                                        |
| [`docs/dev/curved-arrow-svg.md`](../docs/dev/curved-arrow-svg.md)                                   | Math for constructing tangent-aligned arrowheads on circular-arc SVG arrows                                                                                                                                                                                            |
| [`docs/dev/target-recommender.md`](../docs/dev/target-recommender.md)                               | Target recommender pipeline: filters, scoring, diversity cap, altitude preferences, known constraints                                                                                                                                                                  |
| [`docs/dev/horizon.md`](../docs/dev/horizon.md)                                                     | Terrain (mountain) horizon: data model, DEM ray-trace compute, `/api/horizon` + caching, file import, sky-map overlay, recommender horizon gate                                                                                                                        |
| [`docs/dev/imaging-recipe.md`](../docs/dev/imaging-recipe.md)                                       | Integration time algorithm, filter selection logic, type-family constants, tuning guide                                                                                                                                                                                |
| [`docs/dev/render-performance.md`](../docs/dev/render-performance.md)                               | Transferable canvas-perf techniques from the sky-map render loop: profiling, hoisting invariants, sprite atlas, input coalescing, cache-key bucketing/drift                                                                                                            |
| [`docs/dev/ci.md`](../docs/dev/ci.md)                                                               | GitHub Actions workflows: CI, tests, Electron release builds                                                                                                                                                                                                           |
| [`.claude/skills/add-dso-catalog/SKILL.md`](../.claude/skills/add-dso-catalog/SKILL.md)             | Step-by-step guide for integrating a new DSO catalog, SIMBAD validation step, known data quality issues                                                                                                                                                                |
| [`.claude/skills/test-placement/SKILL.md`](../.claude/skills/test-placement/SKILL.md)               | Guide for testing photo placement / plate solving                                                                                                                                                                                                                      |
| [`.claude/skills/override-dso-metadata/SKILL.md`](../.claude/skills/override-dso-metadata/SKILL.md) | How to add or correct entries in `dso-metadata-overrides.json` and regenerate `dso.json`                                                                                                                                                                               |
| [`.claude/skills/ui-verify/SKILL.md`](../.claude/skills/ui-verify/SKILL.md)                         | Visual verification tiers for a UI change: inline screenshot + checklist for a trivial token/class tweak, the cold-eyes `ui-verify-reviewer` subagent (`.claude/agents/ui-verify-reviewer.md`) for a structural change; enforced by the `ui-verify-guard.js` Stop hook |

## How to use this as a Copilot agent

When asked about any of the following topics, **read the corresponding Claude file first** before answering:

- **Dev setup, commands, lint/format, commit conventions** → read `CLAUDE.md`
- **Frontend work — browser verification, CSS/UnoCSS, ui-verify, i18n specifics** → read `src/CLAUDE.md`
- **Backend work — env vars, API routes, Swagger, backend logging** → read `server/CLAUDE.md`
- **Writing or updating tests — the testing rule, Vitest setup, fixtures** → read `tests/CLAUDE.md`
- **DSO / filter catalog regeneration scripts** → read `scripts/CLAUDE.md`
- **Which doc file owns a topic (user vs dev)** → read `docs/CLAUDE.md`
- **Frontend or backend modules, data flows, types** → read `docs/dev/architecture.md`
- **DSO catalog structure, SIMBAD validation, rating/difficulty** → read `docs/dev/dso-catalog.md`
- **User-facing features, plate solving, installation** → read `docs/user/user-guide.md`
- **End-user install/self-hosting instructions (desktop app, Docker, LAN)** → read `docs/user/installing-app.md`
- **Building from source, Electron packaging internals, deployment config reference** → read `docs/dev/distribution.md`
- **GitHub Actions workflows, CI, release builds, docs deployment** → read `docs/dev/ci.md`
- **Canvas/render performance, per-frame loop optimisation, profiling traces** → read `docs/dev/render-performance.md`
- **CSS classes, colour palette, component patterns, UI red flags** → start at the `docs/dev/ui-guidelines.md` hub, then its chapter under `docs/dev/ui/` (`tokens.md`, `components.md`, or `patterns.md`)
- **Curved-arc SVG arrows, arrowhead geometry** → read `docs/dev/curved-arrow-svg.md`
- **Imaging recipe / integration time / filter selection logic** → read `docs/dev/imaging-recipe.md`
- **Adding a new DSO catalog** → read `.claude/skills/add-dso-catalog/SKILL.md`
- **Testing photo placement** → read `.claude/skills/test-placement/SKILL.md`
- **Overriding/correcting DSO metadata** (wrong name, type, coords) → read `.claude/skills/override-dso-metadata/SKILL.md`
- **Verifying a UI change before presenting it** → read `.claude/skills/ui-verify/SKILL.md` (structural changes go through the `.claude/agents/ui-verify-reviewer.md` subagent)

Do not answer from memory alone for these topics — the files may have been updated since your last read.

## Principle

Copilot files in this repository contain **no independent knowledge**. They exist only to point Copilot at the authoritative Claude files. If you find yourself writing substantive content into a `.github/` file, stop and put it in the appropriate Claude file instead.

### Where things live

| Content type                                                 | Location                                                                                 |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Cross-cutting AI-agent guidance (commands, commits, gate)    | root `CLAUDE.md`                                                                         |
| Task-specific AI-agent guidance                              | the nearest per-directory `CLAUDE.md` (`src/`, `server/`, `tests/`, `scripts/`, `docs/`) |
| Narrative documentation (features, architecture, deployment) | `docs/dev/` or `docs/user/`                                                              |
| Reusable agent skills and step-by-step workflows             | `.claude/skills/<name>/SKILL.md`                                                         |
| Copilot pointers (this file)                                 | `.github/copilot-instructions.md` — references only, no content                          |

New per-directory guidance goes in that directory's `CLAUDE.md`, not the root file — it
loads only when a file in that directory is opened. Add a corresponding row to the
source-of-truth table above.

**Skills never go in `.github/`.** When creating a new skill, place `SKILL.md` under `.claude/skills/<name>/`, then add a row to the source-of-truth table above and a bullet in "How to use this as a Copilot agent".
