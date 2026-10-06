Proposed — not in the code. The bottom tab bar of the mobile app: five top-level destinations (Sky, Library, Targets, Plans, Settings), always visible, replacing the desktop `#view-tabs` row and side panel.

## Use

Place `.mob-tabbar` at the bottom edge of every top-level screen. Each tab is a `.mob-tab` button holding a `.mob-tab-pill` (the icon) and a one-word label in the `m-caption` style. Exactly one tab has `aria-selected="true"`. The destinations map to the desktop views: Sky = the sky map, Library = the gallery, Targets = the Find-targets surface, Plans = the plan list, Settings = the settings modal turned into a screen. The labels in the preview are French ("Ciel", "Galerie", "Cibles", "Plans", "Réglages"); take the real strings from `t('...')`.

## You supply

- Five tabs, in this order, each with an icon and a label of one word. Icons are the app's own: `local-sky.svg` (Sky), `image.svg` (Library), `target.svg` (Targets), `plan-list.svg` (Plans) and a drawn gear (Settings: 24 by 24 viewBox, `fill="none"`, 2px round stroke, same weight as the others; the code has no `settings.svg` yet). Inline them; they use `currentColor`.
- `role="tablist"` on the bar, `role="tab"` and `aria-selected` on each tab.
- The bottom safe area: the bar adds `env(safe-area-inset-bottom)` as padding, so it must sit flush with the screen edge and the viewport needs `viewport-fit=cover`.

## States

- Height `mobile-tabbar-height` (56px) plus the bottom safe area; every tab is at least `mobile-touch-min` wide and tall.
- Inactive: `text-secondary` icon and label. Selected: `text-bright` with a pill of `accent-bg` behind the icon (55 % fill, the "selected" step of the icon-button scale). Pressed: the pill takes `accent-fill-lg` (35 %).
- No hover state. Keyboard focus is a 2px `text-bright` ring inside the tab.

## Do / Don't

- Do keep the five tabs on every screen; do not hide the bar on scroll.
- Do keep labels to one word so five fit a 360px-wide phone.
- Don't add a sixth tab or a badge with information that is only there; put overflow in Settings.
- Don't use the desktop `view-tab` styling or a keyboard shortcut to switch tabs.
