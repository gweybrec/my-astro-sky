# Phase 6 — What every phone screen card shares

Every worker of a phone screen card reads this file, then `.claude/work-packages/phase-3/WP3-common.md` (step 0, commits, what is always forbidden, the report), then its card. The branch is named in the worker's instructions.

## Never commit a picture

Screenshots, renders of boards, comparison pictures and device pictures are never staged or committed, anywhere in the repository (rule of the user, 2026-10-11): they take space in git and go stale. They live under the git-ignored `.playwright-mcp/`. The only pictures in git are the ones the app itself ships (icons, launcher images). If a board's picture is missing from `.playwright-mcp/mobile-boards/`, render it from its source with `design/mobile/tools/serve.mjs`.

## The specification is the board

- Each screen has an approved board: its source `design/mobile/boards/<Name>.dc.html` and `<Name>Landscape.dc.html`, and its pictures `.playwright-mcp/mobile-boards/<Name>.png` and `<Name>Landscape.png`. The table of `docs/dev/ui/mobile.md` gives each board's exact title. Read the board's HTML before writing the screen: structure, order, class names (`.mob-*`), icons, texts and states come from there. `design/mobile/tools/serve.mjs` renders a board locally (stop it when done; kill only your own process).
- **Never print a text, a description, a helper sentence, an icon or a control that the board does not show.** When something the screen needs is not on a board (a missing state, a missing sheet), stop and report it; do not design it.
- The rules of `docs/dev/ui/mobile.md` ("Rules that bind every phone screen") apply to every screen. The ones most often broken: an eye icon only shows or hides; adding is a plus button; icon-only action buttons show their name beside the button on a long press; save and validate buttons are green, other actions use the action colour; every delete asks for confirmation; an error is a red toast at the bottom; lists, switches and sliders apply at once, forms use Annuler / Valider; sheets take the height of their content; no horizontal row of chips that scrolls; no keyboard shortcut.

## How a screen is built

- **Ionic's own components first** (`IonButton`, `IonItem`, `IonList`, `IonInput`, `IonSearchbar`, `IonSelect`, `IonToggle`, `IonRange`, `IonModal`, `IonAlert`, `IonToast`, `IonActionSheet`, `IonRefresher`, `IonReorderGroup`…), given the look through the shared phone components of `apps/mobile/src/components/` (created by WP6.1a) and the theme files. A screen does not restyle an Ionic component itself and does not rebuild one from plain elements. If a board's element cannot be made from an Ionic component, say which and why in the report.
- **Colours, sizes, fonts and spacing come from the design system's tokens.** No literal colour or pixel size in a screen, except a layout value the board itself fixes that has no token (then name it as a CSS variable in the page's style with a comment giving the board).
- **Width and orientation.** The boards are 412 wide; real phones are 360 to 430 wide (the user's is 384 × 832). Fixed sizes and margins follow the board; flexible elements take the remaining width; nothing is scaled or clipped; long texts wrap or end with an ellipsis as the board's own long cases do. Landscape follows the landscape board. The safe areas (top, bottom, left, right) are each applied once, through the frame's variables: a screen never reads `env(safe-area-inset-*)` itself.
- **Navigation.** Sub-pages are routes inside their tab (Ionic's router outlet, with its back button and swipe); sheets are `IonModal` with the content's height; dialogs are `IonAlert` or the shared confirm component. The Android back button closes the top-most sheet or dialog, else goes back one page, else (on a tab's first page) leaves the app: this already works in the frame and must keep working (there is a test of the decision; extend it when you add a new kind of layer).
- **Texts** go through `t('…')`. When the same text exists in the desktop's dictionaries, reuse its key. New keys go to `packages/core/src/i18n/mobile/{fr,en,es,de}.ts`, in the four languages. French is written exactly as on the board.

## Alignment is not optional (rule of the user, 2026-10-12)

"Alignment is not an option, icons MUST be properly aligned pixel perfect, and no pixel hardcoding is allowed (because it must remain aligned if the content changes)." A screen with a misaligned row is not done, whatever else works.

- **Alignment is structural.** An item is in line with another because of how their container lays them out: flex or grid with `align-items` / `align-self` (`center`, `baseline`, `stretch`), `justify-content`, `gap`, grid tracks. Text beside a chip shares the baseline of the text **inside** the chip, never the chip's border. An icon beside text is aligned by the row, and sized by a token or in `em`.
- **No nudge.** Never a literal length in `top`, `bottom`, `left`, `right`, `inset`, `margin` (negative margins included), one-sided `padding`, `transform: translate`, `vertical-align`, nor a fixed `height` or `line-height`, chosen to bring something into line. If it would break when the text wraps, when the font is larger, when the label is longer or in another language, it is a nudge. `npm run verify` runs `apps/mobile/scripts/check-no-nudges.mjs`, which fails on these; its allow-list is for true overlays and element sizes only, each with a reason.
- **An Ionic component that misaligns its content** is corrected through its own CSS variables or shadow parts, or by laying out its content in your own row; never compensated from outside.
- **Measure, on the board and on the app.** For every row a card builds or changes, in the rendered page at 384 × 832, 412 × 915 and 832 × 384: text against the text inside chips of the same row (baselines); an icon against the text or the row it belongs to (centres, as the board has them); items stacked on a common edge (leading texts, trailing values, chevrons, switches, handles, against each other and the page margin); symmetric paddings. Each within 0.5 px, and the same relationship as measured on the rendered board. Then again with a long text that wraps or is cut, with several chips and with none, in the four languages, and with the root font size at 130 %. `apps/mobile/scripts/check-alignment.mjs` does this on the dev gallery page: add every new kind of row to that page, in those variants, and run it.
- **Look at rows, not at pages.** A side-by-side picture of two whole screens hides a two-pixel error. For each kind of row, compare a crop of two rows at three times the size with the same crop of the board. The orchestrator opens these crops for every card.
- The report of every card gives the measurement table (board and app) and the list of any length added to a position, margin or transform, with its reason.

## Where logic lives

- A screen holds no rule of the domain. Data comes from the functions of `@myastrosky/app-state/api` and the stores of `@myastrosky/app-state/stores/*`; computation comes from `@myastrosky/core/*`.
- **Never import from the repository's `src/`** (a lint rule forbids it). When the logic a screen needs exists only inside a desktop module of `src/` (a private method of a large screen class, a function mixed with page building), **extract it first**: move the pure part to `packages/core` (or `packages/app-state` for a store), make the desktop module call the extracted function in place of its own copy, keep the desktop's tests green, add unit tests for the extracted function. The desktop's behaviour does not change. The extraction is part of the card and is listed in the report (what moved, from which lines, which desktop call sites now use it).
- Device-only state (the observer's location, filters, the last choices) is read and written through the same core modules and storage keys the desktop uses (`@myastrosky/core/platform/storage`), so the two apps behave alike.

## A control that needs something not built yet

A board may show a control whose effect needs a part of the app that does not exist yet (the sky map, the photo import, the connection to a computer). Build the control as on the board, **disabled**, with no handler, and list it in the report under "Waiting for another screen". Do not hide it, do not show a message.

## Checks before the commit

1. Component tests in `apps/mobile/tests/` for each screen: it renders the board's states (with data, empty, loading, error) from a fake backend installed with `setBackend`; each action calls the right data function; a delete asks for confirmation first; an error shows the toast.
2. **In a phone-sized browser** (ports free, otherwise report and skip; the desktop's server alone with `DB_PATH` and `UPLOADS_DIR` in an empty scratchpad folder, seeded through the api with the data the board shows where possible; `npm run mobile:dev`; your own process trees killed afterwards): each screen at 384 × 832, 412 × 915 and 832 × 384, a screenshot of each in `.playwright-mcp/mobile-<wave>/`, and for each a comparison picture with the board at the same scale. Measure against the board's CSS (heights, paddings, font sizes and weights, colours, icon sizes, touch areas of at least 48 × 48) and fix every difference that is not explained by the width. Open every comparison picture and look at it.
3. `npm run verify` green: read the test summary line and the exit code.

## Report, in addition to the common items

Per screen: the board(s) used; Ionic components used; anything not made from an Ionic component and why; differences from the board that remain and why · logic extracted from `src/` · "Waiting for another screen" · states or sheets missing from the boards.
