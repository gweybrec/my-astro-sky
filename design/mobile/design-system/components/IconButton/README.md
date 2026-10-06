The square, label-less button for per-item and toolbar controls (show/hide, edit, delete), with one fill scale shared by every icon button in the app.

## Use

Classes: `btn-icon` (rest), `btn-icon--active` (selected toggle), `btn-icon--danger` (destructive, red icon) and `btn-icon--danger-active` (selected destructive toggle). Each class carries the whole base, so use one of them alone, not `btn-icon` plus a modifier.

Use it for controls that act on one item in a list or on a toolbar: eye, pen, trash, add. For a text action use `Button`.

## You supply

- A single inline SVG from `assets/Icons` as the only child. The SVG is single-ink and uses `currentColor`, so the button's `color` recolours it; it is sized by the button to `1em`.
- `aria-label` (the button has no text) and, for a toggle, `aria-pressed="true|false"`.
- The class that matches the state: swap `btn-icon` for `btn-icon--active` when the toggle is on.

## States

Background fill rises monotonically: rest 0 %, hover `accent-fill-lg` (35 %), selected `accent-bg` (55 %), selected hover `accent-bg-hover` (75 %). A hovered unselected button must never look more filled than a selected one.

| State            | Fill                                         | Border                          | Icon              |
| ---------------- | -------------------------------------------- | ------------------------------- | ----------------- |
| Rest             | transparent                                  | `border-white-md`               | `text-primary`    |
| Hover            | `accent-fill-lg`                             | `border-focus`                  | `text-bright`     |
| Selected         | `accent-bg`                                  | `border-focus`                  | `text-bright`     |
| Selected, hover  | `accent-bg-hover`                            | `border-focus`                  | `text-bright`     |
| Danger           | transparent, hover `btn-danger-hover-bg`     | hover `btn-danger-hover-border` | `color-danger`    |
| Danger, selected | `btn-danger-bg`, hover `btn-danger-bg-hover` | `btn-danger-border`             | `btn-danger-text` |

The selected states are marked important in the app so they beat the base rule whatever the rule order.

## Do / Don't

- Do use the trash icon with the danger class for every delete or remove of one item.
- Do show "off" as the plain button at rest.
- Don't dim an off state with opacity, and don't invent per-button colours.
- Don't use a plain cross for a destructive per-item action; the cross is for dismiss and close.
- Don't use it on the mobile layer: it measures about 30px; use `.mob-icon-btn` (48px) instead.
