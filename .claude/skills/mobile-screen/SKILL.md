---
name: mobile-screen
description: >
  Build or change a screen of the phone app (apps/mobile): follow its mockup, use Ionic
  through the shared components, keep logic in the shared packages, align by layout,
  test with a fake backend, and check in a phone-sized browser before the real phone.
  Trigger phrases: "phone screen", "mobile screen", "mobile app screen", "build the
  screen", "apps/mobile", "phone UI", "mobile page", "mobile sheet", "mobile tab".
---

# Phone Screen

Read first: `apps/mobile/CLAUDE.md` and `docs/dev/ui/mobile.md` (the rules every phone screen follows; do not copy them into code comments or other docs). Testing on the real phone is the other skill, `mobile-device-test`.

## Step 1 — Start from the mockup

- Mockups live in Claude Design only. The user gives the screen's title. A local, git-ignored copy of their source may exist in `design/`; use it when present.
- Structure, order, texts, icons, states and sheets come from the mockup. If a state, a sheet or a control is missing from it, **ask the user**. Never design it yourself.
- Never print a text, a description, an icon or a control the mockup does not show.

## Step 2 — Build

- Use Ionic's components, through the shared components of `apps/mobile/src/components/` and `src/composables/` (`useConfirm`, `useErrorToast`). No plain `<button>` or `<input>`.
- Tokens only: no raw colour or size. A screen does not restyle an Ionic component.
- Every text goes through `t('…')`. Reuse an existing key when the text exists. New keys go in `packages/core/src/i18n/mobile/{fr,en,es,de}.ts`, all four languages.
- Width 360 to 430 CSS px, and landscape. The frame applies the safe areas; a screen never reads `env()`.
- A control that needs a part of the app that does not exist yet is drawn as on the mockup and left inert (disabled, no handler, no message).

## Step 3 — Logic

- Data comes from `@myastrosky/app-state`, computation from `@myastrosky/core`. Import nothing from the desktop's `src/` or `server/`.
- If the logic exists only in a desktop module: move the pure part to `packages/core` (or `packages/app-state` for a store) first, make the desktop call it, keep the desktop's tests green, and add tests for the moved function.

## Step 4 — Alignment

- Align by layout (`align-items`, `gap`, grid tracks, shared baselines), never by a pixel offset. Text beside a chip shares the baseline of the text inside the chip. Trailing items (information button, switch, chevron, handle) are separated by the spacing token.
- Add each new kind of row, in its variants (long text, several chips, none), to the dev gallery page `/dev/components`.
- `npm run verify` includes `apps/mobile/scripts/check-no-nudges.mjs`, which rejects pixel offsets.
- Run the `check-alignment` skill's command (`npm run check:alignment`) after every change to a row, a component or a theme file. It starts its own servers and browser, measures the components page and the real screens, and prints figures. Add a screen's views to its rules file (see the skill).

## Step 5 — Behaviour to keep

- A sheet takes the height of its content. It closes by dragging it down from its header, by tapping the backdrop and with the back button.
- The back button closes the top-most sheet or dialog, else goes back one page, else (on a tab's first page) leaves the app. A new kind of layer extends the test of that decision.
- Every delete or clear asks for confirmation. An error is a red toast.

## Step 6 — Tests

In `apps/mobile/tests/`, with a fake backend installed by `setBackend`. Cover the states: with data, empty, loading, error. Each action calls the right data function; a delete confirms first; an error shows the toast. Run `npx vitest run apps/mobile/tests/<file>.test.ts`, then `npm run typecheck:mobile`.

## Step 7 — Check in a phone-sized browser

1. Make sure ports 3001 and 5174 are free. If something else holds them, it is not yours: do not kill it, report it.
2. Start the desktop's server alone (`npm run dev:server`) with `DB_PATH` and `UPLOADS_DIR` pointing to a new empty folder in the scratchpad. Never use the user's data. Seed it through the API if the screen needs data.
3. Start `npm run mobile:dev` (port 5174).
4. Open the screen at 384 x 832, 412 x 915 and 832 x 384. The system bars are 0 in a browser: set `--safe-top` and `--safe-bottom` to `24px` on `<html>` to match a phone. Check the console has no error.
5. Screenshots go under the git-ignored `.playwright-mcp/`, never into git.
6. Stop only the process trees you started (record their ids at launch, kill the whole tree), then check with `netstat` that the ports are free.

Then ask the user whether to test on the real phone with the `mobile-device-test` skill.

## Step 8 — Definition of done

- `npm run verify` is green: read its test summary line and its exit code.
- `npm run check:alignment` prints `PASS`.

## What not to do

- Write no status, progress, plan or review note in a tracked file. Report to the user in the conversation.
- Commit no picture (screenshot, render, crop, comparison), and no mockup or design source.
- Do not commit unless the user asks.
