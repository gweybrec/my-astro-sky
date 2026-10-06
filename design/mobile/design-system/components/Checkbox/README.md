The standard on/off control: a native checkbox tinted with `accent-color`, always wrapped in a `<label>` so the text is a click target.

## Use

Wrap an `<input type="checkbox">` and its text in `<label class="dso-toggle-label">` for a checkbox row in a panel (display and settings toggles). Add `checkbox-danger` to the input for a destructive option; its tint is `accent-danger`. For the tristate select-all above a list, set the native `indeterminate` property from script (not built here).

## You supply

- The label text, from `t('...')`: "Afficher les étoiles", "Traits des constellations".
- `checked` / `disabled` state and the change handler.
- In Vue, use the `CheckRow` component for new display and settings toggles.

## States

- Unchecked, checked: native box tinted by `accent-color`.
- Disabled: the native disabled look; fade the row label with 40% opacity if it is the only cue.
- Row: `text-label`, 13px, `space-3` gap and vertical padding.
- Keyboard focus: the app's 2px `spinner-active` ring on `input:focus-visible`.

## Do / Don't

- Do keep the label clickable by wrapping the input.
- Do use `checkbox-danger` only for options that delete or discard data.
- Don't draw a custom checkbox: the native control follows the theme through `accent-color`.
- Don't use a checkbox for an immediate action; use a toggle `IconButton` or a button.
- On mobile, the whole row is the tap target: give it at least `mobile-touch-min` of height (use a `ListRow` with a trailing checkbox).
