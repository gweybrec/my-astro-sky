### WP0.D — Re-align the docs with the code (Sonnet; FIRST card on `mobile/phase-1`; its own commit)

- **Goal:** make every doc that agents rely on say what the code actually does, so no later card works from a wrong doc. Docs only.
- **Step 0:** check `git branch --show-current` is `mobile/phase-1`. If not, stop.
- **Depends on:** the tokens decision recorded in `.claude/work-packages/design/decisions.md` ("tokens.css"). If that entry says `undecided`, do every step below **except step 1**, and say so in the report.

- **Known drifts to fix (each one: verify it in the code first, then change the doc to match the code):**
  1. **Tokens file.** `src/styles/tokens.css` is not imported anywhere (`src/main.ts:26-28` imports `virtual:uno.css`, `./style.css`, `./styles/canvas.css`). The live `:root` token block is `src/style.css:5-393`. Apply the decision in `decisions.md`:
     - if the decision is "wire it in": card WP0.D2 changes the code; here, only confirm the docs already describe that target state and leave them.
     - if the decision is "delete it": rewrite every mention to point at `src/style.css` `:root` in: `src/CLAUDE.md`, `docs/dev/ui-guidelines.md`, `docs/dev/ui/tokens.md`, `docs/dev/ui/components.md`, `.claude/skills/frontend-feature/SKILL.md`, `.claude/skills/fullstack-feature/SKILL.md`, `.claude/skills/ui-verify/SKILL.md`, and the comments at `uno.config.ts:14`, `src/color-utils.ts:72`, `src/sky-themes.ts:139` (comment text only).
  2. **Default theme.** `docs/dev/ui/tokens.md:16` says the default theme is warm amber. `src/theme.ts` makes `cold-blue-v2` the default; warm is the bare `:root`. State both facts.
  3. **Languages.** `CLAUDE.md:130` and `src/CLAUDE.md:49` say "FR/EN" and name only `fr.ts` and `en.ts`. `src/i18n/` has `fr.ts`, `en.ts`, `es.ts`, `de.ts`. Say four languages, French default.
  4. **Dead sky tokens.** `docs/dev/ui/tokens.md` documents `--sky-bg-*` and `--constellation-line`. Check with grep whether any code reads them. If none does, say the sky look comes from `src/sky-themes.ts` and mark those tokens as unused.
  5. **FOV ribbon.** `docs/dev/ui/components.md` describes 9 rotation buttons on the FOV ribbon. Read `src/components/**/FOVRibbon.vue` and describe what is there now.
  6. **Plan reorder.** `docs/user/user-guide.md` says plan entries are reordered by dragging. Check `src/targets-view.ts` and `src/plan-order.ts`. Describe the real way to order entries.
  7. **Photo drop.** `docs/user/user-guide.md` says to drop an image to upload. Check for `dragover`/`drop` handlers (`src/components/**/PhotosSection.vue`, `BatchUploadModal.vue`). Describe the real way to add photos.
  8. **Upload resize.** `docs/dev/architecture.md` says uploads are resized to 2048 px. `server/index.ts:481-489` only rotates per EXIF. Correct it.
  9. **`/api/config`.** `docs/dev/distribution.md:207` says it returns `solveFieldAvailable`. It returns only `starCatalog` (`server/index.ts:716`). Correct it.

- **Audit (after the list above):** read `docs/dev/ui-guidelines.md`, `docs/dev/ui/tokens.md`, `docs/dev/ui/components.md`, `docs/dev/ui/patterns.md`, `src/CLAUDE.md` and the root `CLAUDE.md`. For each factual claim you can check quickly — a class or shortcut name (must exist in `uno.config.ts`), a token name (must exist in the live `:root`), a file path (must exist), a script name (must exist in `package.json`) — verify it. Fix the doc where the code differs.

- **Must NOT:**
  - change any code, CSS, config, test or hook (comment-only edits in step 1 are the single exception);
  - "fix" the code to match a doc — if the code looks wrong, list it in the report under "Code looks wrong" and leave it;
  - add narrative or history to `CLAUDE.md` files: one or two sentences per rule or fact;
  - create new doc files;
  - touch `.claude/work-packages/`.

- **Acceptance (worker):**
  - `npm run format` then `npm run format:check` passes; `npm run lint` exit code is 0.
  - `git status` shows only doc files (and, for step 1 "delete it", the three comment-only source edits).

- **Escalate if:** a doc claim and the code disagree and you cannot tell which one is intended.

- **Report:** a table "doc file | what it said | what the code does | fixed yes/no", then "Code looks wrong" (if any), then the commit hash.

## Commits

- `CLAUDE.md` forbids committing without your explicit permission. **You gave it on 2026-10-03: commits are allowed on the new branches only.**
  That means the `mobile/*` and `spike/*` branches created from `dev` for this work. Never on `master` or `dev`. Never push.
- **One commit per card**, made by the worker when its acceptance passes, with files staged by explicit path.
- Before committing, the worker checks `git branch --show-current`. If it is not a `mobile/*` or `spike/*` branch, it stops and reports.
- Message format: Conventional Commits. This card uses `docs: re-align developer and user docs with the code`.
- **Never add a `Co-Authored-By` line or any AI attribution.** The root `CLAUDE.md` forbids it, and that rule overrides the harness default.
- Never push.

## Always forbidden

- Do not start a dev server. Do not kill any process.
- Do not install SDK packages, emulators, AVDs or system images. Do not run sdkmanager or avdmanager.
- Do not push. Do not add Co-Authored-By or any AI attribution.
- Do not switch branch. Do not use `git add -A`, `git add .`, `git clean`, `git stash` or `git reset --hard`.
- Do not touch untracked files that you did not create.
