# WP2.0k — Re-align the docs after the router split

Model: sonnet · Depends on: WP2.0j · Needs device: no · Needs browser: no

## Goal

The docs, the skills and the per-folder guides still say that the routes are in `server/index.ts`. After WP2.0a to WP2.0j they are in
`server/routes/*.ts`, the app is built in `server/app.ts`, and `server/index.ts` only starts it. Correct every statement that is now wrong, so
that no later worker reads wrong docs.

## Step 0

Check `git branch --show-current` is `mobile/phase-2` and that `git status --short` shows no modified tracked files. If not, stop.

## Steps

1. List the real layout first: `server/index.ts`, `server/app.ts`, `server/server-paths.ts`, every file in `server/routes/` with its router name
   and its routes (read the files; do not copy this list from a card).
2. Search for `server/index.ts` and `index.ts` in: `README.md`, `CLAUDE.md`, `server/CLAUDE.md`, `tests/CLAUDE.md`, `docs/dev/architecture.md`,
   `docs/dev/distribution.md`, `docs/dev/solve-field-placement.md`, `docs/dev/ci.md`, `docs/dev/mobile-architecture.md`,
   `.claude/skills/fullstack-feature/SKILL.md`, `.claude/skills/add-photo-metadata/SKILL.md`, `.github/copilot-instructions.md`. For each hit,
   decide whether the sentence is still true (the entry point is still `server/index.ts`; commands such as `tsx watch server/index.ts` are still
   right) or now wrong (anything saying where routes, helpers or Swagger comments live). Fix only the wrong ones.
3. `docs/dev/architecture.md`: in the backend part, add a short table of the files in `server/routes/` (file, what it serves), and one sentence
   each for `server/app.ts`, `server/index.ts`, `server/server-paths.ts`, `server/routes/shared.ts`, `server/routes/mappers.ts`.
4. `server/CLAUDE.md`: say where a new route goes (the router file of its domain; a new domain gets a new file and one `app.use` line in the
   mount block of `server/app.ts`), that the `@swagger` comment stays next to the route, and that `tests/unit/server-app.test.ts` lists every
   route and must be updated when a route is added or removed. Keep it to a few sentences.
5. `.claude/skills/test-placement/SKILL.md`: it says a FITS file can only be given as a companion of a JPEG or PNG. Check this against the code
   (`POST /api/photos/convert` and the import code in `src/`). If the app also accepts a FITS or TIFF file on its own, correct the skill. If the
   code does not confirm it, change nothing and say so in the report.
6. Line-number references into the old `server/index.ts` (for example in the `add-photo-metadata` skill): replace each by the file and the
   route or function name, with no line number.

## Must NOT

- Create a new doc file.
- Change any file under `server/` other than `server/CLAUDE.md`, or anything under `src/`, `packages/`, `tests/`.
- Rewrite sections that are still true.
- Touch `.claude/work-packages/README.md` (the orchestrator owns it) or `PLAN.md` (a record of the approved plan).

## Acceptance (worker)

- A search for `server/index.ts` in the files of step 2 returns only sentences that are still true; list them in the report.
- `npm run verify` is green.

## Escalate if

- A doc describes behaviour that the code no longer has, beyond file locations.

## Commits

- `CLAUDE.md` forbids committing without the user's explicit permission. **The user gave it on 2026-10-03: commits are allowed on the new
  branches only.** That means the `mobile/*` and `spike/*` branches. Never on `master` or `dev`. Never push.
- **One commit**, with files staged by explicit path. Before committing, check `git branch --show-current` is `mobile/phase-2`.
- Message: `internal(docs): describe the server routers`.
- **Never add a `Co-Authored-By` line or any AI attribution.**

## Always forbidden

- Do not kill any process you did not start. Do not start a dev server.
- Do not install SDK packages, emulators, AVDs or system images. Do not run sdkmanager or avdmanager.
- Do not push. Do not switch branch. Do not use `git add -A`, `git add .`, `git clean`, `git stash` or `git reset --hard`.
- Do not touch untracked files that you did not create.

## Report

Files changed · each corrected statement (old, new) in one line · statements left as they are · what you found for step 5 · verify result.
