# CLAUDE.md — `docs/`

Auto-loaded when you touch a file under `docs/`. Cross-cutting rules stay in the root
`CLAUDE.md`.

## Documentation architecture

This repository has two doc audiences with separate folders. **Never mix them.**

| File                                | Audience                 | Owns                                                                                                                                                                              |
| ----------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/user/getting-started.md`      | Astronomers / end users  | First-run walkthrough: uploading and placing your first photo, navigating the sky map                                                                                             |
| `docs/user/installing-app.md`       | Astronomers / end users  | Getting the app running: desktop app download/install/uninstall, self-hosting via Docker, LAN sharing                                                                             |
| `docs/user/user-guide.md`           | Astronomers / end users  | Features, UI, plate solving methods, solver installation, how to access the running app                                                                                           |
| `docs/user/installing-solvers.md`   | Astronomers / end users  | Installing ASTAP, solve-field, and astrometry.net API key setup, per OS                                                                                                           |
| `docs/user/troubleshooting.md`      | Astronomers / end users  | Common problems and fixes: plate solving, photo placement, UI, desktop app logs                                                                                                   |
| `docs/dev/architecture.md`          | Developers               | Module descriptions (frontend + backend), data flows, key types                                                                                                                   |
| `docs/dev/dso-catalog.md`           | Developers               | SIMBAD validation, known OpenNGC data quality issues, rating/difficulty field docs                                                                                                |
| `docs/dev/distribution.md`          | Developers / maintainers | Building/running from source, Electron packaging internals, env var & CSP config reference                                                                                        |
| `docs/dev/solve-field-placement.md` | Developers               | Y-axis convention, EXIF orientation correction, plate solving diagnostic checklist                                                                                                |
| `docs/dev/ui-guidelines.md`         | Developers               | UI reference **hub**: CSS architecture + shortcuts cheat-sheet, linking to chunked chapters under `docs/dev/ui/` (`tokens.md`, `components.md`, `patterns.md`)                    |
| `docs/dev/curved-arrow-svg.md`      | Developers               | Math for constructing tangent-aligned arrowheads on circular-arc SVG arrows                                                                                                       |
| `docs/dev/imaging-recipe.md`        | Developers               | Integration time algorithm, filter selection logic, type-family constants, tuning guide                                                                                           |
| `docs/dev/target-recommender.md`    | Developers               | Target recommender pipeline: filters, scoring formula, diversity cap, altitude preferences, known constraints                                                                     |
| `docs/dev/horizon.md`               | Developers               | Terrain (mountain) horizon: data model, DEM ray-trace/compute, `/api/horizon` + caching, file import, sky-map overlay, recommender horizon gate                                   |
| `docs/dev/render-performance.md`    | Developers               | Transferable canvas-perf techniques from the sky-map render loop: profiling, hoisting per-frame invariants, sprite atlas, input coalescing, cache-key bucketing/drift             |
| `docs/dev/ci.md`                    | Developers               | GitHub Actions workflows: CI, tests, Docker image build/smoke-test, Electron release builds; also documents the (workflow-free) GitHub Pages docs deployment                      |
| `docs/dev/mobile-architecture.md`   | Developers               | How the desktop and phone apps share code: packages and dependency rules, the backend seam, services, ports and platform adapters, the phone app, constraints measured on a phone |
| `docs/dev/working-on-both-apps.md`  | Developers               | How the desktop and phone UIs are kept apart, how the phone app adapts to portrait and landscape, where to start a change and what to test for each kind of change                |

**Rules:**

- User-facing content (features, how to use, how to install a solver) → `docs/user/`
- Technical content (implementation, deployment, architecture, build steps) → `docs/dev/`
- `CLAUDE.md` itself holds only AI-agent guidance (commands, conventions, brief pointers) — it does not duplicate the content of the doc files
- Do not create new doc files without updating this table and the Copilot instructions (`.github/copilot-instructions.md`)
- The `docs/dev/ui/` chapters (`tokens.md`, `components.md`, `patterns.md`, `mobile.md`) are children of the `ui-guidelines.md` hub — reached via its Contents links, intentionally **not** listed separately in `docs/_sidebar.md` or in this table

## What documentation is, and what never goes into the repository

Documentation describes **how the software works and the rules to follow when changing it**. It is written in the present tense and stays true until the code changes.

**Never write in a doc file (nor in any tracked file):**

- progress, status or "done / to do" lists; approval or review records; "as built" or test logs; who decided what and when;
- dates of decisions, work-item or card numbers, plan phases, names of test sessions;
- references to screenshots or to files that are not in the repository;
- plans for features that do not exist yet (a doc may state a rule for future code, not a roadmap).

That is ticketing. It belongs in a ticketing system or in local, untracked notes; report it to the user in the conversation instead.

**Never commit, anywhere in the repository:**

- **Screen captures and rendered pictures** of the app or of mockups (before/after, comparison, device captures). They take space for ever and go stale. Keep them under the git-ignored `.playwright-mcp/`. The only pictures in git are those the product ships or its user guide shows.
- **Mockups and design sources** (mockup files, design-system exports, their generators). They live in Claude Design only. A local copy, when needed to build a screen, stays in the git-ignored `design/`. What the app needs at run time (its stylesheet, tokens, icons) lives in the app as code.
- **Work tracking**: task cards, plans, status tables, review notes. Local copies stay in the git-ignored `.claude/work-packages/` and `.claude/tracking/`.
- Generated or bulky files (build outputs, exports, archives, test data dumps).

**Ask the user first, and wait for an explicit yes,** before adding a new top-level folder, a new kind of file, or anything that is not source code, tests, build configuration or documentation as defined above. A plan the user approved is not that yes.

When a finding is worth keeping (a measured constraint, a platform quirk), write it as a timeless fact in the page that explains the code it affects, without the story of how it was found.
