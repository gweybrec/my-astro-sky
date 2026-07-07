---
name: ui-verify
description: >
  Mandatory visual verification before presenting any UI change (panels, widgets,
  CSS, uno.config.ts, imperative DOM in *.ts, canvas overlays). Take a screenshot
  of the CHANGED component and report a per-element checklist — colours, sizes,
  alignment, overflow-on-rename — read from the screenshot/DOM, never from memory.
  A Stop hook (ui-verify-guard.js) blocks the turn until this is done.
  Trigger phrases: "UI change", "verify UI", "before presenting UI", "check
  alignment", "check colors", "screenshot the component", "did it render".
---

# UI verify

Run this after **any** structural / CSS / DOM edit and **before presenting**. A Stop hook blocks
the reply until the checklist + `<!-- ui-verified -->` sentinel is emitted (and a screenshot was
taken). If the user said they'll test it themselves, skip with `<!-- ui-verified: <reason> -->`.

## Do

1. Make sure the app is running (`npm run dev`, port 5173) and navigate to the changed screen.
2. Screenshot the **changed component**, not the whole page:
   `browser_take_screenshot` with `element` + a `target` selector (e.g. `.obs-window-row`).
3. Measure — never eyeball, never recall. Use `browser_evaluate`:
   - `getBoundingClientRect()` for sizes/positions (assert equality for alignment),
   - `getComputedStyle(el)` / `el.style` for colours,
   - toggle active/hover state and re-check icons are not blank.
4. Read every value in the table below from step 2–3 output. If a value contradicts what you
   expected, fix the code and re-verify — do not report it as fine.

## Required output (paste before presenting, close with the sentinel)

Screenshot: `<component selector>` — browser_take_screenshot

| element                             | colour (icon / text / bg) | size / height | alignment | overflow-safe | ✓   |
| ----------------------------------- | ------------------------- | ------------- | --------- | ------------- | --- |
| …one row per NEW or EDITED element… |                           |               |           |               |     |

Gates — each ✅ with the measured evidence:

- **Vertical stacks share a left edge** — equal `rect.left` across rows/items.
- **Row controls share height; columns align** — equal `rect` height, equal per-column `left`.
- **Colours correct** — icons/text legible on their background, incl. **active/hover** (icon not
  blank/invisible); custom overlay colours are translucent enough to see content behind.
- **Overflow-safe on change** — with the longest label / a rename / empty / max value, nothing
  clips, overlaps, or shifts the layout (test the actual worst case).
- **Every fixed/hardcoded size justified** — for each `w-[Npx]`, `h-[Npx]`, fixed column width,
  state why a fixed value instead of content-adaptive sizing (`min-width` + `max-content` /
  `fit-content`, `auto`, flex/grid intrinsic). A fixed size that can clip/overflow its content is a
  **no-go** (this is the exact bug that clipped the long filter name).

`<!-- ui-verified -->`

## Rules this enforces

See [[feedback-control-row-layout]] (matched heights, aligned columns via grid + `display:contents`,
units outside inputs, translucent overlay colours) and [[feedback-css-verify-before-reuse]] (read a
class's real properties; reuse existing widgets, never raw native pickers). CSS placement follows
the decision tree in `docs/dev/ui-guidelines.md`.
