### WP0.0 — Set up the work-package folder (Haiku; first card on `mobile/phase-1`)

- **Goal:** commit the cards and the status table, and add the ignore rules, before anything else runs.
- **Context:** the files in `.claude/work-packages/` already exist as **untracked** files. They are written right after plan approval,
  by a Haiku subagent spawned from the planning session (see "Next steps"). The orchestrator needs them to exist before its first run.
- **Steps:**
  1. Check that `.claude/work-packages/README.md`, `phase-0/` and `phase-1/` exist. If they don't, stop and report.
  2. Add `spikes/**`, `**/android/**` and `**/ios/**` to the ESLint ignores (`eslint.config.js:17`) and to `.prettierignore`.
  3. Stage `.claude/work-packages/`, `eslint.config.js` and `.prettierignore` by path, and commit.
- **Acceptance:** `npm run lint` and `npm run format:check` pass.

## Commits

- `CLAUDE.md` forbids committing without your explicit permission. **You gave it on 2026-10-03: commits are allowed on the new branches only.**
  That means the `mobile/*` and `spike/*` branches created from `dev` for this work. Never on `master` or `dev`. Never push.
- **One commit per card**, made by the worker when its acceptance passes, with files staged by explicit path.
- Before committing, the worker checks `git branch --show-current`. If it is not a `mobile/*` or `spike/*` branch, it stops and reports.
- Message format: Conventional Commits. Use `internal(refactor): …` for moves and plumbing, `internal(mobile): …` for spikes.
- **Never add a `Co-Authored-By` line or any AI attribution.** The root `CLAUDE.md` forbids it, and that rule overrides the harness default.
- Never push.

## Always forbidden

- Do not start a dev server. Do not kill any process.
- Do not install SDK packages, emulators, AVDs or system images. Do not run sdkmanager or avdmanager.
- Do not push. Do not add Co-Authored-By or any AI attribution.
- Do not switch branch. Do not use `git add -A`, `git add .`, `git clean`, `git stash` or `git reset --hard`.
- Do not touch untracked files that you did not create.
