Proposed — not in the code. A row of two to four mutually exclusive options with the selected one filled: the touch replacement for a small native `<select>` or a pair of toggle buttons.

## Use

`.mob-seg` (a `role="radiogroup"`) holds two to four `.mob-seg-btn` buttons (`role="radio"`, `aria-checked`). Use it for a short, always-visible choice: hemisphere (Nord / Sud), Moon distance (Proche / Moyenne / Éloignée), live or date mode. For five or more options use a list of `ListRow`s in a `BottomSheet`.

## You supply

- Short labels through `t('...')`, each a single word or two so the segments share the width equally.
- The group's `aria-label` and `aria-checked` on each segment; the selected segment uses the `m-body-strong` style, the others `m-body`.
- The change handler; exactly one segment is selected at any time.

## States

- Each segment is at least `mobile-touch-min` (48px) tall; the container adds `space-1` padding and uses `mobile-card-radius` on `bg-input`.
- Unselected: transparent, `text-secondary`. Pressed: `accent-fill-lg`. Selected: `accent-bg` fill, `border-focus` border, `text-bright`. There is no hover state.
- Keyboard focus: a 2px `text-bright` ring inside the segment.

## Do / Don't

- Do keep the selected state readable without colour: the label is also set in the strong weight.
- Do use it for choices that apply immediately.
- Don't use it for navigation between screens (that is the `TabBar`) or for on/off settings (use a checkbox row).
- Don't let labels wrap or truncate; shorten them instead.
