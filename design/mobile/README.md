# Phone app mockups (source)

The approved mockups of the phone app. The page that lists them with their approval and the rules that bind every screen is `docs/dev/ui/mobile.md`; the pictures are in `docs/dev/ui/mobile/`. This folder is outside `docs/` so that the documentation site does not publish it, and it is ignored by ESLint and Prettier (generated HTML and scripts, not app code).

The pages on claude.ai listed in `.claude/work-packages/design/decisions.md` are copies of this source.

## Folders

- `boards/`: one `<Name>.dc.html` (portrait, 412 x 915) and `<Name>Landscape.dc.html` (landscape, 915 x 412) per screen, 58 of each, and `canvas.json` (each board's title, size, position and order). `support.js` is the runtime the `.dc.html` files load. The boards link `../ds/...` and `../tools/landscape.css`.
- `ds/myastrosky/`: the design system as the boards use it: `tokens.css` and `components/bundle.css` (the `.mob-*` classes).
- `design-system/`: the design system's own source (`design-system.json`, `tokens.json`, `components/`, `assets/` with the logo and the icons, `README.md`). Its `components/bundle.css` is byte-identical to `ds/myastrosky/components/bundle.css`.
- `tools/`: the generators (`build-screens.mjs`, `build-landscape.mjs`, `landscape-lib.mjs`, `landscape-recipes.json`, `landscape.css`), the local page server (`serve.mjs`) and `measurements.md` (what was measured at each revision).
- `plain/`: written by the generators, not committed (see `.gitignore`).

## Open one board

```bash
node design/mobile/tools/serve.mjs        # http://127.0.0.1:8791, serves design/mobile/
```

Then open `http://127.0.0.1:8791/boards/Backup.dc.html` (set the browser window to the board's size from `canvas.json`). The fonts come from Google Fonts, so a network connection is needed.

## Regenerate the boards

```bash
node design/mobile/tools/build-screens.mjs      # portrait boards (the markup lives in this script)
node design/mobile/tools/build-landscape.mjs    # landscape boards, from the portrait ones and landscape-recipes.json
```

Both rewrite `boards/*.dc.html` in place (and `plain/`). `build-screens.mjs` reads the app's icons from `src/icons/`. Changing the design system's stylesheet means editing both copies of `bundle.css` (`ds/` and `design-system/`) so they stay identical. `build-landscape.mjs` prints four known "MISSED" hunks (`GearSetupEdit`, `IdentifyChoose`, `IdentifyInfo` and one more); their boards are unchanged.
