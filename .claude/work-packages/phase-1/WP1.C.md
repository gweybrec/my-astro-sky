### WP1.C — Fix three alignment defects in the desktop CSS (Sonnet; after stretch D2 and its browser check; three commits)

- **Goal:** remove three measured alignment defects from the desktop app, each proven by browser measurements before and after. The user asked for these fixes on 2026-10-03.
- **Needs browser: yes.** This card is run with the user present. Unlike the other cards, the worker MAY start the dev server, following the root `CLAUDE.md` ("Stopping a dev server you started"): check that ports 5173 and 3001 are free first; if they are busy, stop and report; stop only the server you started (full process tree) and confirm the ports are free at the end.
- **Step 0:** check `git branch --show-current` is `mobile/phase-1` and that `git status --short` shows no modified tracked files. If not, stop.
- **Read first:** `src/CLAUDE.md` ("Before adding CSS"), `docs/dev/ui-guidelines.md` (the "where do new styles go" decision tree), `docs/dev/ui/components.md`, `.claude/skills/ui-verify/SKILL.md`.

- **Rule for all three:** measure in the running app with Playwright (`getBoundingClientRect`, `getComputedStyle`) BEFORE changing anything, change one thing, measure AFTER. Every number in the report comes from a measurement. Use tokens only: no hard-coded colour or pixel value. Put each rule where the decision tree says, and say which branch you took.

- **Defect 1 — a `<select>` is shorter than an `<input>` under `input-base`.**
  - Measured in isolation: input 29.1px high, select 27.2px. Cause: the shortcut sets `line-height: 1.5`, and Chromium forces `line-height: normal` on a menulist select; the app has no rule to compensate.
  - Find three real screens where a `select.input-base` sits in the same row as an `input.input-base` (grep `input-base` in `src/`). Measure both heights and tops there.
  - Fix so that a select and an input with this class have the same height (±0.5px) and the same top when they share a row. A `<textarea>` with `input-base` must keep its own height. Do not change the input's height.
  - Commit: `fix: match the height of select and input fields`.

- **Defect 2 — the icon in an icon button sits below centre.**
  - Measured in isolation: the SVG's centre is 1.56px below the button's centre. Cause: `.btn-icon svg { vertical-align: middle }` aligns the icon inside a text line box.
  - Fix so that the icon's centre equals the button's centre on both axes (±0.5px), for `btn-icon`, `btn-icon--active`, `btn-icon--danger`, `btn-icon--danger-active`.
  - The button's outer width and height must not change by more than 0.5px. Icon buttons whose child is a text glyph (`×`, `⚙`, `↺`…) and not an SVG must not move: measure three of them before and after.
  - Measure on at least three real screens (photo list row buttons, a modal toolbar, the gallery filter bar).
  - Commit: `fix: centre icons in icon buttons`.

- **Defect 3 — text buttons have two heights.**
  - Measured in isolation: `btn-action` and `btn-confirm` are 41.1px high; `btn-cancel` and `btn-danger` are 37.1px. Cause: the shortcuts use `py-5` for the first pair and `py-4` for the second. In a modal footer the layout stretches them to the same height, so the difference only shows where they are not stretched.
  - Decision (planner): give `btn-cancel` and `btn-danger` the vertical padding of `btn-action` and `btn-confirm`. The primary buttons do not change.
  - Before changing: list every place where `btn-cancel` or `btn-danger` is used (grep), and for each one measure the button and its container. After changing: no container may overflow, no row may grow by more than the 4px of the button itself, and in modal footers nothing changes (±0.5px).
  - Update the measurements in `docs/dev/ui/components.md` if it states button heights or paddings.
  - Commit: `fix: give cancel and danger buttons the same height as action buttons`.

- **Must NOT:**
  - touch anything under `packages/` or `server/`;
  - change colours, fonts or any other property than the ones needed for these three fixes;
  - add rules to `src/style.css` unless the decision tree leaves no other place — then say why;
  - "fix" other misalignments you notice: list them in the report under "Seen, not fixed".

- **Acceptance:**
  - For each defect: a before/after table of the measured values, on the real screens named above, in the `cold-blue-v2` and `warm` themes.
  - One screenshot per defect after the fix (zoomed on the controls).
  - No console errors. `npm run verify` green after each commit.
  - The dev server you started is stopped and both ports are free.

- **Escalate if:** a fix changes the size of a container, or moves a control on a screen you did not expect; the only way to fix a defect needs a hard-coded pixel value; ports are busy.

- **Report:** the three before/after tables; where each rule was put and why; "Seen, not fixed"; the three commit hashes.

## Commits

- `CLAUDE.md` forbids committing without your explicit permission. **You gave it on 2026-10-03: commits are allowed on the new branches only.**
  That means the `mobile/*` and `spike/*` branches created from `dev` for this work. Never on `master` or `dev`. Never push.
- This card makes **three commits**, one per defect, each when that defect's acceptance passes, with files staged by explicit path.
- Before committing, check `git branch --show-current`. If it is not a `mobile/*` branch, stop and report.
- Message format: Conventional Commits, as given in each defect above.
- **Never add a `Co-Authored-By` line or any AI attribution.** The root `CLAUDE.md` forbids it, and that rule overrides the harness default.
- Never push.

## Always forbidden

- Do not kill any process you did not start.
- Do not install SDK packages, emulators, AVDs or system images. Do not run sdkmanager or avdmanager.
- Do not push. Do not add Co-Authored-By or any AI attribution.
- Do not switch branch. Do not use `git add -A`, `git add .`, `git clean`, `git stash` or `git reset --hard`.
- Do not touch untracked files that you did not create.
