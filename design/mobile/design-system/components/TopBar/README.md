Proposed — not in the code. The bar at the top of a mobile screen: the screen title, a search field that takes the remaining width, and one action button.

## Use

Place `.mob-topbar` at the top of a screen. Children, left to right: `.mob-topbar-title` (the screen name, in the `m-title` style), `.mob-search` (a search `<input>` in the `m-body` style) and one `.mob-icon-btn`. Use it on list screens such as Targets, Plans and Library where search is the main entry. A screen with no search keeps the title and the action only.

## You supply

- The title and the search placeholder through `t('...')`: "Cibles", "Rechercher M31, NGC 7000…".
- One action icon from `assets/Icons` (inline, `currentColor`), with an `aria-label`; for a toggle set `aria-pressed`.
- The top safe area: the bar adds `env(safe-area-inset-top)` as top padding, so it must start at the screen edge.

## States

- Height `mobile-topbar-height` (56px) plus the top safe area; the search field and the action are `mobile-touch-min` (48px) tall; gutters are `mobile-gutter` (16px).
- Search: `bg-input` fill, `border-input` border, `border-focus` on focus, text at 16px so the field does not trigger a zoom.
- Action: transparent with `border-white-md`; pressed `accent-fill-lg`; selected `accent-bg`. There is no hover state.
- Keyboard focus is a 2px `text-bright` ring.

## Do / Don't

- Do keep the title to one short word so the search field keeps room.
- Do keep one action; more actions go in a `BottomSheet`.
- Don't put a back arrow and a tab title in the same bar; pushed screens replace the title with a back button of `mobile-touch-min` size.
- Don't rely on a placeholder as the only label: keep `aria-label`.
