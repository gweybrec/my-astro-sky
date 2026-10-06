The single-line text field of MyAstroSky: dark input fill, 1px input border, border-focus on focus, one class for every text input and textarea.

## Use

Put `input-base` on an `<input>` (or `<textarea>`). It captures the shared base of the app's search, coordinate, tag and date fields; use it for any new text input rather than adding a bespoke field class. Add `input-error` plus an `input-error-msg` sibling for validation.

## You supply

- A `<label class="input-label">` above (or to the left of) the field, tied with `for`/`id`. Mandatory fields append `<span class="required-star"> *</span>`.
- Placeholder and value strings through `t('...')`: "Rechercher M31, NGC 7000…". Placeholders are `text-dim`.
- For validation, toggle `input-error` on the field and render a short `input-error-msg` below it; remove both as soon as the user types again. A toast is not a validation message.

## States

- Rest: `bg-input` fill, `border-input` border, `text-primary` value, `radius-sm`, 13px text, padding `space-2` by `space-4`.
- Focus: border becomes `border-focus` and the outline is removed (the border change is the focus cue).
- Disabled: 60% opacity.
- Error: `status-error-border` border plus a 1px `status-error-text` outline; message in `status-error-text`, 11px.
- An `<input>` and a `<select>` under `input-base` have the same height.

## Do / Don't

- Do keep the field full-width inside its container; set the container's width, not the field's.
- Do keep the label colour `text-label`, 11px.
- Don't hide a label to save space; use a placeholder only as a hint.
- Don't set the font size below 16px on the mobile layer: the desktop 13px field triggers a zoom on iOS; use `.mob-search` or the `m-body` style.
