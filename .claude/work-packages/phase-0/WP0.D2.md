### WP0.D2 — Make `tokens.css` the single home of the design tokens (Sonnet; right after WP0.D; its own commit)

- **Goal:** the design tokens live in exactly one place, `src/styles/tokens.css`, which the app loads. No copy remains in `src/style.css`. No value changes: every token keeps the value the app uses today.
- **Step 0:** check `git branch --show-current` is `mobile/phase-1`. If not, stop.

- **Context (verified 2026-10-03):**
  - `src/main.ts:26-28` imports `virtual:uno.css`, `./style.css`, `./styles/canvas.css`. `tokens.css` is imported nowhere.
  - `src/style.css:5-393` is a `:root { … }` block of 296 tokens. This is the live copy.
  - `src/styles/tokens.css` holds the same 296 names with identical values, **except** two lines (276-277):
    - `tokens.css` has `--hints-confirmed-bg` and `--hints-confirmed-text` (used nowhere);
    - `style.css` has `--hints-active-border: rgba(200, 160, 50, 0.45)` and `--hints-active-bg: rgba(200, 160, 50, 0.06)` (used at `style.css:1713-1714`).
  - The theme overrides `[data-theme='cold-blue']` and `[data-theme='cold-blue-v2']` are further down in `src/style.css`. They must keep winning over `:root`, so `tokens.css` must load **before** `style.css`.

- **Steps:**
  1. Before changing anything, save the live token list: extract every `--name: value;` line of the `:root` block at the top of `src/style.css` into a scratch file outside the repo (name and value, sorted).
  2. Make `src/styles/tokens.css` match the live block exactly: replace its lines 276-277 with the two `--hints-active-*` lines from `src/style.css`. Remove `--hints-confirmed-bg` and `--hints-confirmed-text` after confirming with grep that nothing in `src/`, `uno.config.ts` or `index.html` uses them.
  3. Compare: the sorted `--name: value;` list of `tokens.css` must now be identical to the scratch file from step 1. If it is not, stop and report the differences.
  4. In `src/main.ts`, add `import './styles/tokens.css';` on the line **before** `import './style.css';`.
  5. In `src/style.css`, delete the whole top `:root { … }` token block and its header comment (lines 1-393 region). Delete nothing else. The `[data-theme=…]` blocks stay.
  6. Run `npx vite build`.

- **Must NOT:**
  - change any token value or name;
  - move the `[data-theme=…]` override blocks, or any other rule;
  - edit docs (they already describe this target state; WP0.D handled the rest);
  - start a dev server.

- **Acceptance (worker) — all objective:**
  1. Step 3's comparison is identical (296 names, same values).
  2. `grep -c "^:root" src/style.css` is 0, and `grep -n -- "--bg-app:" src/style.css` shows matches only inside `[data-theme=…]` blocks.
  3. `grep -c -- "--bg-app:" src/styles/tokens.css` is 1.
  4. In the built CSS (`dist/assets/*.css`), the first `--bg-app:` appears **before** the first `[data-theme=`.
  5. `npm run verify` is green.

- **Acceptance (browser check, run later with the user present — not part of this card):** in each of the three themes (`warm`, `cold-blue`, `cold-blue-v2`), the computed value of every token on `document.documentElement` equals the value recorded on `dev` before this card, and the app looks unchanged.

- **Gotchas:**
  - `src/CLAUDE.md` says not to add rules to `src/style.css`. Deleting from it is fine.
  - The Prettier hook reformats the files you edit; compare names and values, not raw lines.
  - Vite/Lightning CSS may merge or reorder identical declarations in the bundle; acceptance 4 checks order only.

- **Escalate if:**
  - the two token lists differ in more than the two known lines;
  - anything reads `--hints-confirmed-bg` or `--hints-confirmed-text`;
  - the `:root` block in `style.css` contains something that is not a custom property;
  - acceptance 4 fails after the import is placed before `style.css`.

- **Report:** the files changed, the five acceptance results, the commit hash.

## Commits

- `CLAUDE.md` forbids committing without your explicit permission. **You gave it on 2026-10-03: commits are allowed on the new branches only.**
  That means the `mobile/*` and `spike/*` branches created from `dev` for this work. Never on `master` or `dev`. Never push.
- **One commit per card**, made by the worker when its acceptance passes, with files staged by explicit path.
- Before committing, the worker checks `git branch --show-current`. If it is not a `mobile/*` or `spike/*` branch, it stops and reports.
- Message format: Conventional Commits. This card uses `internal(refactor): load design tokens from tokens.css and drop the copy in style.css`.
- **Never add a `Co-Authored-By` line or any AI attribution.** The root `CLAUDE.md` forbids it, and that rule overrides the harness default.
- Never push.

## Always forbidden

- Do not start a dev server. Do not kill any process.
- Do not install SDK packages, emulators, AVDs or system images. Do not run sdkmanager or avdmanager.
- Do not push. Do not add Co-Authored-By or any AI attribution.
- Do not switch branch. Do not use `git add -A`, `git add .`, `git clean`, `git stash` or `git reset --hard`.
- Do not touch untracked files that you did not create.
