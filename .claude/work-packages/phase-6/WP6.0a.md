# WP6.0a — Bring the approved mockups into the repository

Model: sonnet · Branch: `mobile/phase-3b` · Depends on: nothing · Needs device: no · Needs browser: yes (to render pictures; no dev server of the app)

## Goal

The approved phone mockups exist only on a private claude.ai page and in a temporary folder of this session. The workers who will code the screens cannot open the page, and the temporary folder can disappear. Copy the mockups' source into the repository, render one picture per screen, and write the page that lists them with their approval. Nothing of the app changes.

## Where the source is (read-only: never modify these folders)

`S` = `C:\Users\guill\AppData\Local\Temp\claude\c--Workspace-MyAstroSky-MyAstroSky\08c03b88-5ba2-41c9-a4a6-1acc5f26531a\scratchpad`

- `S\mobile-canvas\project\`: one file per screen, `<Name>.dc.html` (portrait) and `<Name>Landscape.dc.html` (landscape), 58 of each; `canvas.json` (the boards: their titles, sizes, order and pages); `ds\myastrosky\` (the design system as the screens use it: `components/bundle.css`, tokens, fonts, icons); `assets\`.
- `S\mobile-canvas\`: the generators (`build-screens.mjs`, `build-landscape.mjs`, `landscape-lib.mjs`, `landscape-recipes.json`, `landscape.css`), a local page server (`serve.mjs`, port 8791) used to render and measure the screens, and `measurements.md` (what was measured at each revision, up to "Revision 15"). Many other files there are old backups (`*.bak.*`, `before*/`, one-off scripts): ignore them.
- `S\design-system\project\`: the design system's own source (`design-system.json`, `tokens.json`, `components/`, `assets/` with the logo and 48 icons, `README.md`). `components/bundle.css` there is byte-identical to the copy under `mobile-canvas\project\ds\myastrosky\components\` (check; if they differ, stop and report).
- The decisions that bind every screen: `.claude/work-packages/design/decisions.md` (in the repository).

Read `S\mobile-canvas\serve.mjs` and `canvas.json` first to learn how a board file is turned into a rendered page (which wrapper, which stylesheets, which size).

## Steps

1. **Copy the source** into `design/mobile/` at the repository root (a new folder, outside `docs/` so that the documentation site does not publish it):
   - `design/mobile/boards/`: the 116 `.dc.html` files and `canvas.json`;
   - `design/mobile/ds/`: the design system as the boards reference it (keep the relative paths the boards use, so that they render from the repository);
   - `design/mobile/design-system/`: the design system's own source;
   - `design/mobile/tools/`: the generators, `serve.mjs`, `landscape.css`, `landscape-recipes.json`, `measurements.md`, adjusted only so that their paths point inside `design/mobile/` (no absolute path to the temporary folder may remain: search for `AppData` and `scratchpad`);
   - `design/mobile/README.md`: what each folder is, how to start the local page server and open one board, how to regenerate the boards, and that the claude.ai pages (links in `decisions.md`) are copies of this source.
   - Add `design/**` to the ESLint ignores and to `.prettierignore` (generated HTML and scripts that are not app code), and check `npm run lint` and `npm run format:check` pass.
   - Report the folder's size. If it is above 30 MB, stop and report what is large (fonts and pictures are expected; duplicates are not).
2. **Render one picture per board**: start `design/mobile/tools/serve.mjs` from the repository copy (check its port is free first; record its process id; stop it at the end, killing only that process), and with the Playwright browser tools take a screenshot of each of the 116 boards at the board's own size (from `canvas.json`), device scale factor 2, saved as `docs/dev/ui/mobile/<Name>.png` and `<Name>Landscape.png`. Wait for the fonts to be loaded before each screenshot (`document.fonts.ready`), and check on three boards that the text is drawn in the design system's font, not a fallback (compare `getComputedStyle` with what `document.fonts.check` reports). If the PNG files total more than 25 MB, convert them to WebP at quality 90 with `sharp` (`.webp`) and say so.
3. **The page** `docs/dev/ui/mobile.md`:
   - "Rules that bind every phone screen": copied from `decisions.md` as a short list (one line each, grouped: navigation, sheets, buttons and icons, texts, forms, deletes and errors, landscape), each line ending with its date;
   - "How the phone app gets this look": the screens are built with Ionic's own components where one exists; the look comes from the design system's stylesheet (`design/mobile/ds/…/components/bundle.css`, the `.mob-*` classes) and its tokens; the fonts are bundled in the app;
   - "Screens": one table per tab (Ciel, Galerie, Cibles, Plans, Réglages, then shared sheets and dialogs), in the order of `canvas.json`, columns: the board's exact title · portrait picture (a link) · landscape picture (a link) · source file · status. Status is `approved 2026-10-04` for the boards that existed at the approval and `approved 2026-10-05 (revision N)` for those added or corrected afterwards: take this from `measurements.md` and `decisions.md`; where you cannot tell, write `approved 2026-10-04` and list the board in the report;
   - "As built": an empty table (screen · date · device picture · differences · status) that the phone work fills in.
   - One known correction not yet drawn, to list under the table: on "Ciel, nom d'un calque (appui long)" (portrait and landscape), the name shown by a long press must sit beside the pressed button (decision of 2026-10-05).
4. **Register the new documentation files** as `docs/CLAUDE.md` requires: the row in its table, the same in `.github/copilot-instructions.md`, a link from `docs/dev/ui-guidelines.md` and the sidebar.

## Must NOT

- Modify anything under the temporary folder `S`.
- Change the look of any board (no regeneration with different inputs): the copy must render identically. Check on five boards (two portrait, two landscape, one dialog) that a screenshot from the repository copy is pixel-identical, or differs by less than 0.1 % of pixels, from a screenshot of the same board served from `S`.
- Start the app's dev server, or kill a process you did not start.

## Commit

`docs: bring the approved phone mockups and their rules into the repository` (one commit, files staged by explicit folder path: `design/mobile`, `docs/dev/ui/mobile`, `docs/dev/ui/mobile.md` and the registered files; include the status row).

## Report

The folder sizes · the number of boards copied and rendered · the font check · the five-board comparison · boards whose approval date you could not establish · anything in the source that did not render.
