# CLAUDE.md — `docs/`

Auto-loaded when you touch a file under `docs/`. Cross-cutting rules stay in the root
`CLAUDE.md`.

## Documentation architecture

This repository has two doc audiences with separate folders. **Never mix them.**

| File                                | Audience                 | Owns                                                                                                                                                                  |
| ----------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/user/getting-started.md`      | Astronomers / end users  | First-run walkthrough: uploading and placing your first photo, navigating the sky map                                                                                 |
| `docs/user/installing-app.md`       | Astronomers / end users  | Getting the app running: desktop app download/install/uninstall, self-hosting via Docker, LAN sharing                                                                 |
| `docs/user/user-guide.md`           | Astronomers / end users  | Features, UI, plate solving methods, solver installation, how to access the running app                                                                               |
| `docs/user/installing-solvers.md`   | Astronomers / end users  | Installing ASTAP, solve-field, and astrometry.net API key setup, per OS                                                                                               |
| `docs/user/troubleshooting.md`      | Astronomers / end users  | Common problems and fixes: plate solving, photo placement, UI, desktop app logs                                                                                       |
| `docs/dev/architecture.md`          | Developers               | Module descriptions (frontend + backend), data flows, key types                                                                                                       |
| `docs/dev/dso-catalog.md`           | Developers               | SIMBAD validation, known OpenNGC data quality issues, rating/difficulty field docs                                                                                    |
| `docs/dev/distribution.md`          | Developers / maintainers | Building/running from source, Electron packaging internals, env var & CSP config reference                                                                            |
| `docs/dev/solve-field-placement.md` | Developers               | Y-axis convention, EXIF orientation correction, plate solving diagnostic checklist                                                                                    |
| `docs/dev/ui-guidelines.md`         | Developers               | UI reference **hub**: CSS architecture + shortcuts cheat-sheet, linking to chunked chapters under `docs/dev/ui/` (`tokens.md`, `components.md`, `patterns.md`)        |
| `docs/dev/curved-arrow-svg.md`      | Developers               | Math for constructing tangent-aligned arrowheads on circular-arc SVG arrows                                                                                           |
| `docs/dev/imaging-recipe.md`        | Developers               | Integration time algorithm, filter selection logic, type-family constants, tuning guide                                                                               |
| `docs/dev/target-recommender.md`    | Developers               | Target recommender pipeline: filters, scoring formula, diversity cap, altitude preferences, known constraints                                                         |
| `docs/dev/horizon.md`               | Developers               | Terrain (mountain) horizon: data model, DEM ray-trace/compute, `/api/horizon` + caching, file import, sky-map overlay, recommender horizon gate                       |
| `docs/dev/render-performance.md`    | Developers               | Transferable canvas-perf techniques from the sky-map render loop: profiling, hoisting per-frame invariants, sprite atlas, input coalescing, cache-key bucketing/drift |
| `docs/dev/ci.md`                    | Developers               | GitHub Actions workflows: CI, tests, Docker image build/smoke-test, Electron release builds; also documents the (workflow-free) GitHub Pages docs deployment          |

**Rules:**

- User-facing content (features, how to use, how to install a solver) → `docs/user/`
- Technical content (implementation, deployment, architecture, build steps) → `docs/dev/`
- `CLAUDE.md` itself holds only AI-agent guidance (commands, conventions, brief pointers) — it does not duplicate the content of the doc files
- Do not create new doc files without updating this table and the Copilot instructions (`.github/copilot-instructions.md`)
- The `docs/dev/ui/` chapters (`tokens.md`, `components.md`, `patterns.md`) are children of the `ui-guidelines.md` hub — reached via its Contents links, intentionally **not** listed separately in `docs/_sidebar.md` or in this table
