Proposed — not in the code. The floating action button: one round, amber button that carries the single main creation action of a mobile screen.

## Use

`.mob-fab` is a 56px (`mobile-fab-size`) round `<button>` with one 24px icon, filled `accent-bg` with an `accent-border` border and a `shadow-lg` shadow. Add `mob-fab--fixed` to pin it `mobile-gutter` from the right edge and `mobile-gutter` above the tab bar; the parent must be `position: relative`. Use it for "add photos" on the Library screen or "new plan" on Plans. One FAB per screen, and only where a primary action exists; never use it for a destructive action.

## You supply

- A single inline icon from `assets/Icons` (for add: `plus.svg`), using `currentColor`.
- `aria-label` with the action name through `t('...')`: "Ajouter des photos".
- The tap handler. Hide it (do not disable it) when the action is not available.

## States

- Rest: `accent-bg` fill, `text-bright` icon. Pressed: `accent-bg-hover` fill and `border-focus` border. There is no hover state.
- Keyboard focus: a 2px `text-bright` ring.
- The icon on `accent-bg-hover` is a mark, held to 3:1 rather than 4.5:1; check the Contrast flags of the active theme.

## Do / Don't

- Do keep it clear of the bottom safe area: the tab bar already absorbs it.
- Do keep it at least `mobile-touch-min` from other tappable elements.
- Don't add a text label inside a FAB; use a `Button` for a labelled action.
- Don't stack two FABs or place one over list rows that scroll under it without bottom padding on the list.
