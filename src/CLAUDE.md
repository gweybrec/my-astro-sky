# CLAUDE.md — `src/` (frontend)

Auto-loaded when you touch a file under `src/`. Cross-cutting rules (commands, commit
conventions, the CI gate, architecture overview) stay in the root `CLAUDE.md`.

## Browser Testing

**Every code change must be verified in the browser before considering it done.** Use the Playwright MCP tools to test visually and interactively.

**UI changes go through the `ui-verify` skill, which the `ui-verify-guard.js` Stop hook enforces.** A trivial token/class tweak gets an inline screenshot + per-element checklist closed by `<!-- ui-verified -->`. A structural change (new DOM / builder fn / `.vue` component, layout CSS) must be signed off by the cold-eyes `ui-verify-reviewer` subagent (`.claude/agents/ui-verify-reviewer.md`) — spawn it, paste its table + `VERDICT`, close with `<!-- ui-verified: reviewer=pass -->`. Either tier is skippable with `<!-- ui-verified: <reason> -->` when the user is verifying.

### Workflow

1. Start the dev server with `npm run dev` (runs Vite on port 5173 + Express on port 3001).
2. Navigate to `http://localhost:5173` using `browser_navigate`.
3. Take a snapshot (`browser_snapshot`) or screenshot (`browser_take_screenshot`) to verify the UI state.
4. Interact with the app (click, type, etc.) to test the modified feature.
5. Check the browser console (`browser_console_messages`) for errors or warnings.
6. **Fix any bug found during testing**, even if unrelated to the current task.

### What to verify

- No console errors or unhandled exceptions.
- UI renders correctly (layout, text, translations).
- Interactive features work (buttons, modals, search, canvas pan/zoom).
- Photos display and transform correctly on the sky map.
- Gallery mode displays photos correctly in grid, navigates to map on click.
- View mode toggle switches between Map and Gallery smoothly.
- Repositioning feature works (extracts current state, allows editing, saves new state).
- Smart sorting works in both photo list and gallery (M1, M8, M31, M100, M101...).
- Targets tab: gear preset selection, location, date, filters, Best/Random buttons, pagination.
- Both FR and EN languages render properly if i18n was touched.

## Before adding CSS

This project uses **UnoCSS** (utility-first, Tailwind-compatible). Agents must follow this checklist or they will create duplicate CSS:

1. **Never use `style=` in Vue templates.** All styling goes through class names.
2. **Check `uno.config.ts` shortcuts first** for an existing named component class (e.g. `btn-action`, `input-base`, `tag-chip`). Use it before inventing a new one.
3. **Use UnoCSS atomic utilities** for spacing, color, flex, layout — `ml-4`, `text-primary`, `flex`, `gap-2`, `w-full`, `hidden`, etc.
4. **Only add to `src/styles/canvas.css`** when the style requires a pseudo-element (`::before`/`::after`), `@keyframes`, a canvas-layer selector, or a `:has()`/sibling combinator that cannot be expressed as a class attribute. Everything else is a UnoCSS class.
5. **New design tokens** go in both `uno.config.ts` theme AND `src/styles/tokens.css` (kept in sync). Never hardcode a color or pixel value directly — always use a CSS variable.
6. **Do not add new rules to `src/style.css`** — it is a legacy file being phased out. All new component styles go to shortcuts or utilities.

See [docs/dev/ui-guidelines.md](docs/dev/ui-guidelines.md) — the UI hub — for the CSS architecture and shortcuts cheat-sheet, then its chapters under `docs/dev/ui/` for design tokens, the component catalog, and layout patterns / known issues.

## Frontend conventions

- **UI text is internationalized (FR/EN).** French is the default language. Translations live in `src/i18n/fr.ts` and `src/i18n/en.ts`. Use `t('key')` for all user-facing strings. Constellation/DSO names use `displayName` (populated per-language at load time).
- `DSO_CATALOGS_ALL` is exported from `dso-catalog.ts` — do not redefine it locally in `ui.ts` or elsewhere.
- **Smart telescopes:** never read a gear setup's `cameraId` directly — resolve it through `resolveSetupCamera()` in `gear-catalog.ts`, which substitutes the scope's `integrated_camera_id`. `tests/unit/gear-catalog-integrity.test.ts` pins each smart scope's FOV to its published spec; extend its table when adding one.
- The runtime DSO density gate ranks by **intrinsic quality** (`dsoImportance` = rating/brightness, in `src/dso-catalog.ts`), area-weighted so on-screen density tracks the true sky (Milky Way denser) with the stereographic projection bias removed — it no longer uses the blue-noise `priority` column, which is retained but currently only informational. See `scripts/CLAUDE.md` for how the derived columns are regenerated.

## Tests

Editing a `.ts` file here? See [tests/CLAUDE.md](tests/CLAUDE.md) for the matching-test-file rule (a PostToolUse hook also runs `npx vitest run` after every `src/**/*.ts` edit).
