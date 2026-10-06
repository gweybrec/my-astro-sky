Proposed — not in the code. A labelled text field and a labelled select, both exactly 48px tall: the touch replacement for the desktop `input-base` on inputs and selects.

## Use

`.mob-field` (an `<input>`) and `.mob-select` (a native `<select>`) sit under a `.mob-field-label`. Use them for every text or choice entry in a form screen or a `BottomSheet`. The TopBar search field, `.mob-search`, shares the same box. Two fields can sit side by side in a two-column grid with the labels on one line; keep each cell a label plus one control so the controls share a top.

A `.mob-select` must sit inside a `.mob-select-wrap` (`<div class="mob-select-wrap"><select class="mob-select">…</select></div>`). The select drops the native look (`appearance: none`) so its value text starts at the same x as a field's, and the wrapper draws the `▾` chevron in `text-secondary` at `space-7` from the right edge. Without the wrapper the select has no chevron.

## You supply

- A visible `<label for>` for each control through `t('...')`; the placeholder never replaces the label.
- The `m-body` class on the control and the `m-secondary` class on the label (the classes carry the 16px and 14px type styles).
- `type`, `value` and the change handler; for a select, the options.
- A grid that gives each column `minmax(0, 1fr)` so neither control can push the row past 360px.

## States

- Rest: `bg-input` fill, `border-input` border, `mobile-card-radius` corners, `space-7` horizontal padding, `text-primary` text, `text-dim` placeholder. The height is set explicitly to `mobile-touch-min` (48px), so a select and an input are always the same height.
- Focus: the border becomes `border-focus`; no outline.
- Disabled: 60 % opacity, default cursor.
- Label: `text-label` colour with `space-2` below it.

## Do / Don't

- Do keep the field and its label together and left-aligned with the other fields of the screen.
- Do use the native `<select>` for four or more options; for two to four always-visible options use a `SegmentedControl`.
- Don't set a `height`, `padding` or `line-height` on a field in a screen; the class owns them.
- Don't use the desktop `input-base` on a touch screen.
