# WP2.5a — Importing a plan brings its setup, and asks when the setup differs

Model: sonnet · Depends on: WP2.3e, WP2.5b · Parallel-safe with: nothing · Needs device: no · **Needs browser: yes (ports 5173 and 3001 must be free)**

## Goal

Decided by the user on 2026-10-04:

1. A plan imported from a backup must not point at a setup that does not exist. If the plan's setup is not on this machine, the import brings the setup too.
2. If a setup that corresponds to it is already on this machine but its **content is different**, the user is asked what to do: **replace**, **keep both**, or **do not import**. Comparing names alone is not enough.

Today the import dialog only lets the user tick or untick each setup; a ticked setup replaces any local setup of the same name, and a plan whose setup is not ticked keeps a `setupId` that may refer to nothing.

This card changes the server, the desktop import dialog and its strings. It follows the `fullstack-feature` skill (`.claude/skills/fullstack-feature/SKILL.md`) and the `ui-verify` skill: read both first, with `src/CLAUDE.md`, `server/CLAUDE.md` and `tests/CLAUDE.md`.

## Step 0

Check `git branch --show-current` is `mobile/phase-2`, that `git status --short` shows no modified tracked files, and that `npx vitest run tests/unit/server-app.test.ts tests/unit/server-backup.test.ts` passes. Check that ports 5173 and 3001 are free; **if one is busy, stop and report** (it may be the user's own app; never kill a process you did not start).

## Definitions

- A local setup **corresponds** to a setup of the bundle when it has the same id; failing that, when it has the same name (the comparison the import already uses for names).
- Two corresponding setups are **identical** when name, `telescopeId`, `cameraId` and `accessoryId` are equal. `enabled` is not compared.
- A setup of the bundle is therefore in one of three states on this machine: `none` (no corresponding local setup), `identical`, `different`.

## Server

1. **Preview** (`POST /api/import/preview`): each entry of `setups` gains `conflict: 'none' | 'identical' | 'different'` and, when not `none`, `localId` (the corresponding local setup's id). Each entry of `plans` gains `setupId` (string or null) as stored in the bundle. Existing fields keep their meaning.
2. **Import** (`POST /api/import`): a new optional form field `setupConflicts`, a JSON object `{ "<bundle setup id>": "replace" | "keepBoth" | "skip" }`. For every setup of the bundle that is ticked (`selectedSetups`) **or** is the setup of a ticked plan:
   - state `none`: import it (this is the "brings its setup" rule; no choice needed). Its custom telescope, camera and accessory that are in the bundle and absent on this machine (by id) are imported too, as if ticked.
   - state `identical`: do not import it. Plans of this import that refer to it are pointed at `localId`.
   - state `different`:
     - choice `replace`: today's behaviour for a ticked setup (the corresponding local setup is replaced); plans keep the bundle's id.
     - choice `keepBoth`: import it under a **new id** (`setup-<uuid>`) with the name followed by " (import)"; plans of this import that refer to it are pointed at the new id. The local setup is untouched.
     - choice `skip`: do not import it; plans of this import that refer to it are pointed at `localId`.
     - **no choice sent:** if the setup is ticked, `replace` (what a ticked setup does today, so that older clients keep their behaviour); if it is only pulled in by a plan, `skip`.
   - A plan whose setup is neither on this machine nor in the bundle is imported as today, `setupId` kept.
3. Put the decision logic in one pure exported function in `server/import-utils.ts` (for example `planSetupImportActions(...)`: bundle plans, bundle setups, bundle custom gear, the selections, the choices, the local setups and custom gear ids; it returns, per setup, the action and the plan remapping, and the extra gear ids to import). The route only applies its result. Unit-test it on its own, every branch.
4. Update the two routes' `@swagger` blocks and regenerate `public/swagger.json`.

## Desktop import dialog (`src/components/modals/ImportModal.vue`, `src/api.ts`, the four language files)

5. `importData` sends `setupConflicts`. The preview types gain the new fields (put shared types in `packages/core/src/domain/backup.ts`).
6. In the setups list of the dialog:
   - a setup required by a ticked plan and in state `none` is shown ticked and cannot be unticked while that plan is ticked, with a short note naming the plan (one line under the setup's name, in the existing secondary text style);
   - a setup in state `identical` shows "already present, identical" in place of the replace warning, and has no checkbox to tick;
   - a setup in state `different` that is ticked or required by a ticked plan shows, in place of today's single warning, a three-option choice: **Remplacer** / **Garder les deux** / **Ne pas importer**, as a control that exists in the app already (read `docs/dev/ui/components.md` and reuse the segmented or radio pattern the app has; do not invent a new one). Nothing is chosen at first; the dialog's confirm button is disabled until every such setup has a choice, with the reason shown the way the dialog already shows why it is disabled, or as a one-line message next to the button.
   - "Ne pas importer" for a setup that is not required by any ticked plan is the same as unticking it.
7. Strings in `fr`, `en`, `es`, `de` (the i18n parity test must pass). French: "Remplacer", "Garder les deux", "Ne pas importer", "Déjà présent, identique", "Importé avec le plan « {name} »", "Un setup différent du même nom existe déjà. Choisissez quoi faire." Translate the others accordingly.
8. Follow `src/CLAUDE.md` for CSS: reuse existing classes; any new rule goes where the decision tree says.

## Tests

- The pure function: every state and choice, the gear dependencies, a plan that is not ticked pulling nothing, a setup required by two plans.
- `tests/unit/server-backup.test.ts`: this card may change this file **only** to: update the plans-only import case (the setup and its custom gear now arrive; replace the comment that recorded the dangling reference); add cases for `identical` (nothing imported, plan pointed at the local setup), and for `different` with each of the three choices and with no choice; add the case of a bundle exported without setups (plan imported, `setupId` kept). The round trip between instances A and B must pass as before.
- A component test for the dialog (`tests/components/`, following the Vue testing patterns in `tests/CLAUDE.md`): the auto-ticked setup, the three-option choice appearing, the confirm button disabled until a choice is made, and the `setupConflicts` value sent.

## Browser verification (ui-verify)

- Start the app with an isolated database and uploads folder (new empty folder in the scratchpad or the OS temp folder; `DB_PATH` and `UPLOADS_DIR` set for that command only), never the user's data. Record the PID of the process tree root.
- Prepare a backup ZIP that produces all three states, import it through the dialog, and take screenshots of the setups part of the dialog: before this change (from `git stash`-free means: take the "before" pictures first, on the untouched tree, before you edit anything) and after, in the default theme and in `warm`, saved to `.playwright-mcp/import-setup-conflict/`. Measure the new control as the ui-verify skill asks (alignment with the row's other parts, no overflow in the dialog at its normal width).
- Run each of the three choices for real and check the result in the app (setups list and the plan's setup).
- Stop the server you started (whole process tree, by PID) and confirm both ports are free.

## Must NOT

- Change the export, or what a ticked image, plan or custom gear item does.
- Touch the mobile mockups or anything outside this feature.
- Use the user's database or uploads. Kill a process you did not start.

## Acceptance (worker)

- The tests above pass; `server-backup.test.ts` passes three times in a row; `npm run verify` is green (it includes the i18n parity test and the build).
- The before and after screenshots exist; the three choices were exercised in the browser with no console error.
- `docs/user/` or `docs/dev/`: where the import is described, add the two rules; say which file.

## Escalate if

- Ports 5173 or 3001 are busy.
- The app has no existing control suited to a three-option choice in a list row.
- The plan remapping cannot be done inside the existing import order without changing what a ticked plan does.

## Commits

- `CLAUDE.md` forbids committing without the user's explicit permission. **The user asked for this commit on 2026-10-04** ("do a commit to fix it"), on the `mobile/phase-2` branch. Never push.
- **One commit**, with files staged by explicit path. Before committing, check `git branch --show-current` is `mobile/phase-2`.
- Message: `fix: import a plan's setup with the plan, and ask when it differs from a local one`.
- **Never add a `Co-Authored-By` line or any AI attribution.**

## Always forbidden

- Do not install SDK packages, emulators, AVDs or system images. Do not run sdkmanager or avdmanager.
- Do not push. Do not switch branch. Do not use `git add -A`, `git add .`, `git clean`, `git stash`, `git reset --hard` or `git checkout -- <file>` on a file you did not change yourself.
- Do not touch untracked files that you did not create.

## Report

Files changed · the pure function's signature · the new preview fields and form field · the control reused for the choice and why · test cases added or changed · screenshot paths · acceptance output · "Seen, not fixed" · deviations · open questions · whether the server is stopped.
