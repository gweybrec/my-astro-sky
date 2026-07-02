# GitHub Copilot Instructions

## Source of truth

**The Claude files are the single source of truth for this repository.**
Copilot instructions and skills must never duplicate knowledge — they always reference the Claude files where the content lives.

| Claude file | What it contains |
|---|---|
| [`CLAUDE.md`](../CLAUDE.md) | Dev commands, browser testing workflow, architecture overview, DSO catalog pointers, conventions |
| [`docs/dev/architecture.md`](../docs/dev/architecture.md) | Full frontend/backend module descriptions, data flows, key types |
| [`docs/dev/dso-catalog.md`](../docs/dev/dso-catalog.md) | SIMBAD validation, known OpenNGC issues, rating/difficulty field docs |
| [`docs/user/user-guide.md`](../docs/user/user-guide.md) | User manual: features, plate solving, installation, how to access the app |
| [`docs/user/installing-app.md`](../docs/user/installing-app.md) | End-user install paths: desktop app download/install/uninstall, self-hosting via Docker, LAN sharing |
| [`docs/dev/distribution.md`](../docs/dev/distribution.md) | Building/running from source, Electron packaging internals, env var & CSP config reference |
| [`docs/dev/ui-guidelines.md`](../docs/dev/ui-guidelines.md) | CSS colour tokens, typography, component class inventory, known CSS issues |
| [`docs/dev/curved-arrow-svg.md`](../docs/dev/curved-arrow-svg.md) | Math for constructing tangent-aligned arrowheads on circular-arc SVG arrows |
| [`docs/dev/target-recommender.md`](../docs/dev/target-recommender.md) | Target recommender pipeline: filters, scoring, diversity cap, altitude preferences, known constraints |
| [`docs/dev/imaging-recipe.md`](../docs/dev/imaging-recipe.md) | Integration time algorithm, filter selection logic, type-family constants, tuning guide |
| [`docs/dev/render-performance.md`](../docs/dev/render-performance.md) | Transferable canvas-perf techniques from the sky-map render loop: profiling, hoisting invariants, sprite atlas, input coalescing, cache-key bucketing/drift |
| [`docs/dev/ci.md`](../docs/dev/ci.md) | GitHub Actions workflows: CI, tests, Electron release builds |
| [`.claude/skills/add-dso-catalog/SKILL.md`](../.claude/skills/add-dso-catalog/SKILL.md) | Step-by-step guide for integrating a new DSO catalog, SIMBAD validation step, known data quality issues |
| [`.claude/skills/test-placement/SKILL.md`](../.claude/skills/test-placement/SKILL.md) | Guide for testing photo placement / plate solving |
| [`.claude/skills/override-dso-metadata/SKILL.md`](../.claude/skills/override-dso-metadata/SKILL.md) | How to add or correct entries in `dso-metadata-overrides.json` and regenerate `dso.json` |

## How to use this as a Copilot agent

When asked about any of the following topics, **read the corresponding Claude file first** before answering:

- **Dev setup, commands, conventions** → read `CLAUDE.md`
- **Frontend or backend modules, data flows, types** → read `docs/dev/architecture.md`
- **DSO catalog structure, SIMBAD validation, rating/difficulty** → read `docs/dev/dso-catalog.md`
- **User-facing features, plate solving, installation** → read `docs/user/user-guide.md`
- **End-user install/self-hosting instructions (desktop app, Docker, LAN)** → read `docs/user/installing-app.md`
- **Building from source, Electron packaging internals, deployment config reference** → read `docs/dev/distribution.md`
- **GitHub Actions workflows, CI, release builds, docs deployment** → read `docs/dev/ci.md`
- **Canvas/render performance, per-frame loop optimisation, profiling traces** → read `docs/dev/render-performance.md`
- **CSS classes, colour palette, component patterns, UI red flags** → read `docs/dev/ui-guidelines.md`
- **Curved-arc SVG arrows, arrowhead geometry** → read `docs/dev/curved-arrow-svg.md`
- **Imaging recipe / integration time / filter selection logic** → read `docs/dev/imaging-recipe.md`
- **Adding a new DSO catalog** → read `.claude/skills/add-dso-catalog/SKILL.md`
- **Testing photo placement** → read `.claude/skills/test-placement/SKILL.md`
- **Overriding/correcting DSO metadata** (wrong name, type, coords) → read `.claude/skills/override-dso-metadata/SKILL.md`

Do not answer from memory alone for these topics — the files may have been updated since your last read.

## Principle

Copilot files in this repository contain **no independent knowledge**. They exist only to point Copilot at the authoritative Claude files. If you find yourself writing substantive content into a `.github/` file, stop and put it in the appropriate Claude file instead.

### Where things live

| Content type | Location |
|---|---|
| Narrative documentation (features, architecture, deployment) | `docs/dev/` or `docs/user/` |
| Reusable agent skills and step-by-step workflows | `.claude/skills/<name>/SKILL.md` |
| Copilot pointers (this file) | `.github/copilot-instructions.md` — references only, no content |

**Skills never go in `.github/`.** When creating a new skill, place `SKILL.md` under `.claude/skills/<name>/`, then add a row to the source-of-truth table above and a bullet in "How to use this as a Copilot agent".
