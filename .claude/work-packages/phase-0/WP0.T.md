### WP0.T — Make the hooks cheaper and consistent (Sonnet; on `mobile/phase-1`)

- **Goal:** cut the cost of the test hook, and remove a rule conflict.
- **Context:** the existing regex at `.claude/hooks/vitest-on-ts-edit.js:15-16` already matches `packages/core/src/x.ts`, because it only looks for a `src` or `server` path segment. The real problem is that line 21 runs the **full** suite.
- **Steps:**
  1. Replace `execSync('npm run test:dot')` with `execFileSync` running `npx vitest related <filePath> --run --reporter=dot --passWithNoTests`.
  2. Keep the exit code: a non-zero exit is a test failure.
  3. In `.claude/agents/ui-verify-reviewer.md`, replace the instruction to kill orphaned dev servers with: "never kill a process you did not start; if the ports are busy, report it".
  4. In `.claude/hooks/ui-verify-guard.js`, accept the agent type `mobile-ui-verify-reviewer` (`:129`) and any `mcp__playwright*__browser_take_screenshot` tool (`:173`). Update `tests/unit/ui-verify-guard.test.ts`.
- **Acceptance:**
  - Editing a leaf file such as `src/color-utils.ts` runs only its related tests (seen in the hook output).
  - `npm run verify` is green.
- **Gotcha:** files imported almost everywhere (`types.ts`, `api.ts`, `i18n`) still trigger most of the suite. That is expected.
- **Escalate if:** `vitest related` is unavailable in the installed vitest.

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
