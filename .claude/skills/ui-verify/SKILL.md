---
name: ui-verify
description: >
  Mandatory visual verification before presenting any UI change (panels, widgets,
  CSS, uno.config.ts, imperative DOM in *.ts, canvas overlays). Screenshot the
  changed element IN CONTEXT with its neighbours, measure it against them and the
  literal request, report a per-element checklist read from the DOM, never memory.
  A Stop hook (ui-verify-guard.js) blocks the turn until done. Trigger phrases:
  "UI change", "verify UI", "check alignment", "check colors", "did it render".
---

# UI verify

After **any** structural/CSS/DOM edit, **before presenting**. Stop hook blocks the reply until the
checklist + `<!-- ui-verified -->` land (screenshot taken). If the user will test it themselves,
skip with `<!-- ui-verified: <reason> -->`. Every gate below exists because a change passed a
shallower check and shipped broken.

## Do

1. **Integrity first** — measurements off a stale page are lies. Confirm ONE dev server is serving
   **current** code (kill orphaned `npm run dev` trees that hold the port and serve old CSS while
   your new server fails to bind), then assert a value you just changed is live in the DOM /
   `getComputedStyle`. If a computed value contradicts your edit, STOP and find the real source
   (orphan/unimported file? later `:root`/theme override? stale page?) — never report green off it.
2. **Screenshot in context, never in isolation** — `browser_take_screenshot` with a `target` that
   includes the new element **and the siblings/row/container it relates to**, at a scale showing
   relative size + alignment. An element-only shot hides the defects this skill catches.
3. **Measure** with `browser_evaluate`, never eyeball/recall: `getBoundingClientRect()` for the new
   element **and each neighbour it lines up with**; `getComputedStyle` for colour/font-size/padding/
   height; toggle active/hover/disabled and recheck icons/text aren't blank.

## Output (paste before presenting)

One line: the request's UI intent (spatial/size words to satisfy, e.g. "next to input, full width,
same height"). Then `Screenshot: <selector incl. neighbours>` and:

| element (new/edited) | colour (icon/text/bg) | size / height | alignment vs neighbour | overflow-safe | ✓   |
| -------------------- | --------------------- | ------------- | ---------------------- | ------------- | --- |

Gates — each ✅ with the **measured** number:

- **Matches the request** — prove each spatial/size word against the named neighbour. "Next to X" =
  adjacent (`new.left ≈ X.right + gap`), not below. "Full width" = `new.width ≈ row.width`. If you
  can't phrase the proof, you didn't satisfy it.
- **Matches row-mates & its twin** — same-row controls: `|Δheight| ≤ 0.5` and equal `top` (native
  `<select>` is ~1–2px taller than `<input>` at equal padding → pin height). Full-width siblings ⇒
  new one full-width (equal `left`+`right`). If this widget already exists elsewhere, diff computed
  `font-size`/`color`/`padding`/`height` vs that instance and reuse its class — no bright/oversized
  new variant.
- **No unrequested change** — the diff must not resize/move/restyle any element the request didn't
  name (e.g. stretching an input to fill a gap). That's a regression; solve it without touching the
  untouched widget.
- **No dead space** — no large empty gap between the element and its neighbours/container edge; a
  control marooned beside a "void" fails even if each metric is green.
- **No overlap** (unless required) — real bbox intersection, not centre math. **Vertical stacks
  share `left`.**
- **Colours/tokens** — legible incl. active/hover (icon not blank); verify the live `--token`, not
  the file you hoped loaded; overlays translucent enough to see through.
- **Overflow-safe** — longest label / rename / empty / max value doesn't clip, overlap, or shift.
- **Fixed size justified** — each `w-[Npx]`/`h-[Npx]`: why it beats content-adaptive sizing and
  can't clip its content. Pinning a height to match a neighbour is fine; a fixed width that clips a
  long value is a no-go.

`<!-- ui-verified -->`

Enforces [[feedback-control-row-layout]] and [[feedback-css-verify-before-reuse]]; CSS placement per
`docs/dev/ui-guidelines.md`.
