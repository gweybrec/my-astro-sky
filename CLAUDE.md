# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

It holds only **cross-cutting** guidance. Task-specific rules live in per-directory
`CLAUDE.md` files, loaded automatically when you read or edit a file in that directory.

## Nested guides

| File                    | Covers                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `src/CLAUDE.md`         | Frontend: browser verification + "what to verify", CSS/UnoCSS rules, ui-verify, i18n details, frontend conventions |
| `server/CLAUDE.md`      | Backend: env vars, `/api` routes, Swagger annotations, backend logging                                             |
| `tests/CLAUDE.md`       | The testing rule, Vitest + happy-dom setup, `tests/fixtures/` inventory, Vue component-test patterns               |
| `scripts/CLAUDE.md`     | DSO catalog regeneration (`dso:generate`) and filter catalog colour seeding                                        |
| `docs/CLAUDE.md`        | The two-audience documentation-file map and its rules                                                              |
| `test-photos/CLAUDE.md` | Raw local test-image inventory (gitignored; present only on machines that have it)                                 |

## Skills

Project-specific skills live in `.claude/skills/`. The harness auto-invokes them on matching trigger phrases.

| Skill                   | When to invoke                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `frontend-feature`      | Adding or changing purely frontend UI (panels, modals, widgets, CSS)                                               |
| `fullstack-feature`     | Adding or changing API routes together with frontend UI                                                            |
| `add-photo-metadata`    | Adding a new optional field to photo metadata (DB, all 3 UI editors, export/import, WCS/astrometry pre-fill)       |
| `add-dso-catalog`       | Integrating a new DSO catalog (RCW, Barnard, Abell…)                                                               |
| `override-dso-metadata` | Correcting DSO names, types, coordinates, or ratings in the static catalog                                         |
| `test-placement`        | Testing astrophoto upload, plate solving, and sky-map placement                                                    |
| `profile-performance`   | Profiling a perf trace / janky pan-zoom: parse a CPU trace into hot functions, pick an optimisation, A/B benchmark |

---

## Development Commands

```bash
npm run dev          # Runs Vite (port 5173) + Express (port 3001) via concurrently
npm run dev:client   # Vite frontend only
npm run dev:server   # Express server with tsx watch (hot reload)
npm run build        # tsc type-check + vite build to dist/
npm run typecheck    # Type-check frontend (vue-tsc) + server (tsc)
npm run typecheck:client  # vue-tsc --noEmit (type-checks .vue SFCs; plain tsc does not)
npm run typecheck:server  # tsc --noEmit -p tsconfig.server.json
npm run preview      # Preview production build
npm test             # Run unit test suite (Vitest)
npm run test:watch   # Vitest in watch mode
npm run test:coverage  # Coverage report (v8)
npx vitest run tests/unit/<file>.test.ts  # Run a single test file
npm run swagger:generate  # Regenerate public/swagger.json from JSDoc annotations
npm run electron:make     # Package desktop app (runs clean + build + electron-forge make)
npm run docs:serve        # Serve docs/ locally with docsify (live-reload) to preview before pushing
```

For DSO catalog regeneration (`npm run dso:generate`) and filter colour seeding
(`npm run filters:seed`), see `scripts/CLAUDE.md`.

### Stopping a dev server you started

`npm run dev` is `concurrently "vite" "tsx watch server/index.ts"` — a process tree (npm → concurrently → vite/tsx). Killing only the port-holding leaf (e.g. `kill-port`) orphans the rest, which accumulate across a session and can eventually lock native modules like `better-sqlite3` (breaking the next `predev`/`npm rebuild`). To stop a server you started, kill its full process tree (record the PID at launch, then tree-kill it), and verify with `netstat`/`Get-NetTCPConnection` afterward — don't trust "port freed" or "process killed" output alone. Never kill a dev server you didn't start yourself in this session — check the process's command line/working directory first, since the user may already have one running.

### Linting & formatting

ESLint (flat config, `eslint.config.js`) + Prettier (`.prettierrc.json`).

```bash
npm run lint          # ESLint over the repo — CAN fail, see below
npm run lint:fix      # ESLint with --fix
npm run format        # Prettier --write (format everything)
npm run format:check  # Prettier --check (CI gate; must pass)
```

**Warn-only convention — and its limit.** Every rule the project configures itself in
`eslint.config.js` is set to `warn`, so the ~800 existing warnings don't block anything:
they are a guardrail against _new_ issues, not a mandate to pay them down. Promote a rule
from `warn` to `error` once its warnings are cleared. Highest-value rules already on:
`@typescript-eslint/no-floating-promises`, `no-unused-vars`, `no-explicit-any`,
`no-console` (allows `warn`/`error`).

**But `npm run lint` is not warn-only overall.** Rules inherited from the `recommended`
presets (`js`, `tseslint`, `vue`) keep their `error` severity unless explicitly downgraded,
so they exit non-zero and **fail the `ci.yml` Lint step**. This is intentional — that set is
small and high-signal — but it means you must check the exit code, never assume lint passes.
(`@typescript-eslint/no-this-alias` once reached CI this way.) Report errors only with
`npx eslint --quiet <file>`.

`endOfLine: "auto"` in `.prettierrc.json` keeps Windows CRLF checkouts from mass-flagging
under `"lf"`. Always use `npm run format` / `format:check`, not raw `npx prettier`.

Two PostToolUse hooks keep both out of CI: `.claude/hooks/prettier-on-edit.js` runs
`prettier --write` on the edited file, and `.claude/hooks/lint-on-ts-edit.js` runs
`eslint --quiet` on it (errors only — warnings would bury the signal).

### Verifying before you push

`npm run verify` runs the whole CI gate in `ci.yml`'s order — typecheck, lint,
format:check, the docs-icon sync check, tests, and the production build. Use it instead of
running the steps by hand: a locally-passing subset is how a lint error reached CI before.

---

## Architecture

**MyAstroSky** overlays astrophotographs onto an interactive sky map (HTML5 Canvas, stereographic polar projection). Photos are positioned via CSS `transform: matrix()` from affine registration. A Targets tab recommends DSOs based on gear, location, and sky conditions.

See [docs/dev/architecture.md](docs/dev/architecture.md) for full module descriptions (frontend + backend), data flows, and key types.

See [docs/dev/ui-guidelines.md](docs/dev/ui-guidelines.md) — the UI hub — for the CSS architecture and shortcuts cheat-sheet, then its chapters under `docs/dev/ui/` for design tokens, the component catalog, and layout patterns / known issues.

See [docs/dev/distribution.md](docs/dev/distribution.md) for deployment options (Docker, Node.js) and the planned Electron desktop packaging.

See [docs/dev/solve-field-placement.md](docs/dev/solve-field-placement.md) for:

- Y-axis convention (`fitsYConvention`) and why it is always `false` for JPEG/PNG input
- EXIF orientation correction (`rawToBrowserCoords`) and the correct formula for each orientation value
- Diagnostic checklist when a newly solved image appears misaligned

## DSO Catalog

`public/data/dso.json` — 12,000+ objects, columnar JSON, 15 fields. Regeneration commands
are in `scripts/CLAUDE.md`.

See [docs/dev/dso-catalog.md](docs/dev/dso-catalog.md) for:

- SIMBAD validation workflow and known OpenNGC errors (including the SH2 systematic coordinate drift)
- Rating and difficulty field documentation and regeneration commands

## Conventions

- **UI text is internationalized (FR/EN).** French is the default language. Translations live in `src/i18n/fr.ts` and `src/i18n/en.ts` (server-side strings in `server/messages.ts`). Use `t('key')` for all user-facing strings. Constellation/DSO names use `displayName` (populated per-language at load time). Frontend specifics: `src/CLAUDE.md`.
- Editing a `.ts` file in `src/` or `server/`? See `tests/CLAUDE.md` for the matching-test-file rule.
- Do not create new doc files without updating the table in `docs/CLAUDE.md` **and** `.github/copilot-instructions.md`.

### Committing

**Never run `git commit` unless the user explicitly asks for it.** Finish the work, report
what changed, and leave it staged or unstaged for the user to review — approval of a plan
is not approval to commit. The same applies to `git push`, tags and branches.

**Never add a `Co-Authored-By` trailer** (or any other AI attribution) to a commit message.

### Commit messages

Use **[Conventional Commits](https://www.conventionalcommits.org)** — the release changelog is generated by parsing them (`cliff.toml` + git-cliff). Accepted types and their changelog sections:

| Type               | Section                | Use for                                             |
| ------------------ | ---------------------- | --------------------------------------------------- |
| `feat:`            | Features               | A brand-new feature/capability                      |
| `improvement:`     | Improvements           | An enhancement to an existing feature (custom type) |
| `fix:`             | Bug Fixes              | A bug fix                                           |
| `perf:`            | Performance            | A speed/efficiency change with no behavior change   |
| `refactor:`        | Refactor               | Internal restructuring worth showing in the notes   |
| `docs:`            | Documentation          | Docs only                                           |
| `test:`            | Testing                | Tests only                                          |
| `style:`, `build:` | Styling / Build System | Formatting, build tooling                           |
| `chore:`, `ci:`    | _(hidden)_             | Skipped from the changelog                          |
| `internal(...):`   | _(hidden)_             | Internal-only work users would not recognise        |

Use `internal(refactor):` (or `internal(<scope>):`) rather than `refactor:` when the
change is pure plumbing — module splits, moving logic behind an interface, test
scaffolding. It is real work, but nothing an astronomer reading the release notes
would recognise, so it is skipped. Reserve plain `refactor:` for restructuring you
_do_ want announced.

Append `!` (e.g. `feat!:`) or a `BREAKING CHANGE:` footer for breaking changes. Preview the _unreleased_ section (since the last tag) to the console with `npm run changelog:preview`; regenerate the actual files with `npm run changelog` (runs `scripts/generate-changelog.mjs`). `CHANGELOG.md` is scoped to the **current major version series**; completed majors are frozen into `CHANGELOG.v<n>.md` archives automatically at the next major release. See [docs/dev/ci.md](docs/dev/ci.md#release-release-yml) for how the release pipeline consumes commits.
