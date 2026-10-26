---
name: check-alignment
description: >
  Verify alignment in the phone app (apps/mobile) with one command: it starts its own servers
  and browser, loads test data, opens the components page and the real screens, measures, and
  prints a few lines of figures. No manual measuring, no pictures.
  Trigger phrases: "check alignment", "alignment", "misaligned", "baseline", "chip alignment",
  "icon not centred", "verify alignment".
---

# Check Alignment

## When

After any change to a row, a component or a theme file of the phone app, and when the user reports a misalignment. Needs an installed Chrome or Edge (`BROWSER_CHANNEL`, default `chrome`); nothing is downloaded.

## The command

`npm run check:alignment` (= `node .claude/skills/check-alignment/scripts/run.mjs mobile`), about one minute. Options: `--view <name>` (one view), `--verbose` (largest figure per view), `--inject "<css>"` (adds a style sheet, to prove a defect is caught), `--crop <view>:<n>` (see below).

It picks free ports, makes a temporary data folder, starts the desktop's server and the phone app's dev server on them, seeds setups, a location, plans with windows and a saved region, opens the views at 384x832, 412x915 and 832x384 (the components page also in four languages and at 130 % text), then stops everything and deletes the folder. It never touches the repository's data.

## Reading the output

- One line per rule: number of measurements, largest figure in px. A rule with 0 measurements matched nothing: check its selectors.
- Then one line per failure: view, size, rule, the two elements, figure and direction ("7.0 px lower", "4.0 px to the right", "8.0 px too close"). `(+N like it)` counts the same failure on other rows or languages.
- Last line `PASS` (exit 0) or `FAIL (n)` (exit 1). Exit 2 is a set-up problem; the line says what to do.

## What it checks, and what it does not

- Rules (`rules/mobile.mjs`): baseline of text and chips, icons and switches centred on their row, equal room above and below, icon centred in its box, items of a bar on one line, gap between the information button and the switch, stacked text starts and trailing edges, empty states centred. Tolerance 0.5 px.
- Only the views listed in the rules file. It does not compare with the mockup, and it runs in a computer's browser, not on the phone (`mobile-device-test` does that).

## On FAIL

1. Fix by layout (`apps/mobile/CLAUDE.md`: flex/grid, `gap`, shared baseline), never by a pixel offset, then run again.
2. Never loosen a rule or raise the tolerance. If a rule flags a layout that is right by design (a second column, two fields side by side), make the rule precise in the rules file (what it applies to).
3. Only when the numbers do not explain it, `--crop <view>:<n>` (the n-th failing line of that view) saves one enlarged picture with the measured lines drawn, in the git-ignored `.playwright-mcp/alignment/`, and prints its path. Once, not routinely.

## Adding a view or a rule

- A new screen or sheet: add `{ name, path, ready, open?, scope? }` to `views` in `rules/mobile.mjs` (`clearStorage` lists keys removed before the page loads, for a first start; `open` is a list of `{ click }`, `{ fill, text }`, `{ wait }`, `{ pause }`; `scope` is the sheet's selector). Seed any data it needs in `seed`.
- Every screen with at least two elements on a line or a column needs its views here, including each state reached by typing or tapping (search results, an open sheet, a selected object); a state the views cannot reach yet means extending the actions, not leaving it out.
- A new kind of row: extend the selectors of the existing rules, or add a rule of an existing type (types are the functions of `scripts/engine.mjs`). A new type is one generic function there, with selectors as parameters.
- Another app: a new file in `rules/` with the same exports (listed at the top of `rules/mobile.mjs`); the engine is not changed.
