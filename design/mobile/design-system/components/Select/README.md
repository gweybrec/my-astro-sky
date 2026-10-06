A native `<select>` dropdown in the input style: `input-base` in forms and modals, `display-controls-select` in the compact side-panel rows.

## Use

Use a native `<select>` for any list of mutually exclusive options (theme, language, drawing style). Do not restyle `<option>` elements: they cannot be styled across browsers. When each option needs a coloured badge (filter types), use the chip input widget, not a select.

- `input-base` on the select: full-width form field (same fill, border and focus as `Input`).
- `display-controls-select`: flexible, 12px, `text-label` value; for a one-line setting inside the side panel.

## You supply

- The `<select>` with its `<option>` list, labels from `t('...')`.
- A `<label class="input-label">` for the form variant, or an `aria-label` for the panel variant.
- Persistence: the app reads the value on `change`; the select holds no state of its own.

## States

- Rest: `bg-input`, `border-input`, `radius-sm`.
- Focus: `border-focus`, no outline.
- Disabled: 60% opacity with `input-base`.
- The open list is drawn by the browser, not by the design system.
- A `<select>` and an `<input>` under `input-base` have the same height.

## Do / Don't

- Do put the label above or to the left.
- Do keep the options short enough for the field width.
- Don't use a select for two options: use two checkboxes or, on mobile, a `SegmentedControl`.
- Don't use a native select inside a mobile bottom sheet for three or fewer options.
