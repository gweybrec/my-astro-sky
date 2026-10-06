# Icons

The 48 SVG icons of `src/icons/`, the app's Tier 1 icon set. Every file is a single-ink icon drawn with `currentColor` (mostly outlines; a few add a filled dot or shape, also in `currentColor`) and carries no `width` or `height`. ViewBoxes differ: 24 units (22 files), 16 (13), 36 (9), 64 (`eye`, `eye-off`, `telescope`) and one in 960 units. Ink: `currentColor`, so the colour comes from the CSS `color` of the element that holds the SVG: `text-primary` at rest, `text-bright` when hovered or selected, `color-danger` for destructive icons.

Because `currentColor` is not inherited by an `<img>` (an image would render black), inline the SVG markup into the button or row instead of using an `<img>`, and size it with CSS (`1em` in `btn-icon`, 16px in floating map buttons, 24px in the mobile layer). Aim at about 1.0–1.3px of on-screen stroke: `stroke-width` 1.5 at 16px for 16-unit icons, 2 at 16px for 24-unit icons, 2 at 18px for 36-unit icons, 4–5 at 16–18px for 64-unit icons.

Where the app uses them (from the imports in `src/`):

- Map and sky-time controls: `local-sky`, `azimuth-grid`, `calendar`, `moon`, `sun`, `planets`, `mountain`, `sky-trajectory`, `map-pin`, `export`, `target`, `telescope`, `eye`, `eye-off`, `rotation-reset`.
- Frames, mosaics and plans: `add-frame`, `add-mosaic`, `anchor`, `list-plus`, `plan-list`, `plus`, `trajectory`.
- Photos and editing: `add-photo`, `image`, `pen`, `trash`, `check`, `close-x`, `dso-galaxy`.
- Points of interest on the map and in the gallery: `poi-asteroid`, `poi-comet`, `poi-iss`, `poi-satellite`, `poi-supernova`, `supernova-pin`, `pin`.
- Settings and legal: `about`, `privacy`, `credits`.
- Present in the folder but not imported anywhere today: `rotate-m1`, `rotate-m5`, `rotate-m15`, `rotate-m45`, `rotate-p1`, `rotate-p5`, `rotate-p15`, `rotate-p45`, `rotate-reset`.

Simple glyphs are not SVG files: the app's Tier 2 icons are Unicode characters (`×`, `⚙`, `↺`, `↻`, `◎`, `▾`, `▶`, `◀`, `✓`, `⚠`, and a few more). Use the SVG when one exists, the glyph otherwise, and ask before adding a new file.
