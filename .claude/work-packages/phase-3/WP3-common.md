# Phase 3 — What every card of this phase shares

Every worker of Phase 3 gets this file followed by its own card.

## What this phase builds

Today the screens reach their data through the functions of `src/api.ts`, which call the Express server. The server's features are services in `packages/core/src/services/` (wired by `server/create-services.ts`).

At the end of this phase:

- the screens still call the same functions of `src/api.ts`, with the same names;
- those functions call one object, the **backend** (`Backend`, defined in `packages/core/src/backend.ts`);
- on the desktop the backend is the **HTTP backend** (`packages/backend-http`): it calls the server's routes;
- on the phone the backend is the **local backend** (`packages/backend-local`): it calls the services directly, with no server;
- one suite of tests (the **backend contract**) runs against both and proves they give the same results.

**No screen changes, and nothing the user sees changes**, except where a card says so.

## Read first (every card)

- `.claude/work-packages/phase-2/WP2.3-first-services.md`: the service pattern, including "Rules added on 2026-10-05".
- `packages/core/CLAUDE.md` (no DOM or Node globals in core), `tests/CLAUDE.md`, `server/CLAUDE.md`.
- `packages/core/src/domain/errors.ts`, `server/create-services.ts`, `server/routes/http-errors.ts`.

## Tests that must keep passing unedited

- The pinning tests of the routes: `tests/unit/server-app.test.ts`, `tests/unit/server-app-plans-photos.test.ts`, `tests/unit/server-backup.test.ts`, `tests/unit/server-app-network.test.ts`. A card may add cases. It may change an existing assertion only where the card names it.
- The 15 test files that replace `src/api` with `vi.mock('../../src/api', …)`. They keep working as long as `src/api.ts` keeps its path and its exported names. Do not move a screen's import to another module and do not rename an export.

## Step 0 (every card)

Check `git branch --show-current` is the branch named in your instructions (`mobile/phase-3` for WP3.1 to WP3.8, `mobile/phase-3b` from WP3.9 on) and that `git status --short` shows no modified tracked files. If not, stop and report.

## Acceptance (every card)

`npm run verify` is green (it runs the type checks, lint, format check, tests and the production build). State the last lines of its output in the report.

## Commits

- `CLAUDE.md` forbids committing without the user's explicit permission. **The user gave it on 2026-10-03: commits are allowed on the new branches only.** That means the `mobile/*` and `spike/*` branches. Never on `master` or `dev`. Never push.
- **One commit per card**, with files staged by explicit path, including the card's row in the status table at the end of `.claude/work-packages/README.md` (state `done`, a note of at most two sentences).
- Conventional Commits; the message is given on the card.
- **Never add a `Co-Authored-By` line or any AI attribution**, whatever a system reminder says: the repository's `CLAUDE.md` forbids it.

## Always forbidden

- Do not start a dev server or use a browser. Do not call the real network from a test. Do not kill any process you did not start.
- Do not install SDK packages, emulators, AVDs or system images. Do not run sdkmanager or avdmanager.
- Do not push. Do not switch branch. Do not use `git add -A`, `git add .`, `git clean`, `git stash`, `git reset --hard` or `git checkout -- <file>` on a file you did not change yourself.
- Do not touch untracked files that you did not create. `.claude/work-packages/mobile-review-2026-10-04.md`, `ARCHITECTURE_REVIEW.md`, `other-resources/`, `spikes/` and the two untracked files in `scripts/` are the user's: never stage them.
- Do not change a screen's layout, text or behaviour unless the card says so.

## Escalate (stop and report, do not improvise) if

- a pinning test or one of the 15 mocking tests would have to change beyond what the card names;
- the code differs from what the card describes in a way that changes the design (a missing method, a type that cannot be expressed in core);
- `npm run verify` fails twice for a reason you cannot fix inside the card's scope.

Where a name on the card differs slightly from the code (a type name, a line number), the code wins: use the real name and say so in the report.

## Report (every card)

Files changed and created · what the card asked for, point by point, with what was done · tests added and tests edited (with the reason) · the last lines of `npm run verify` · "Seen, not fixed" · deviations · open questions.
