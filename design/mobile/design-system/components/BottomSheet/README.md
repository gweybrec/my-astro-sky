Proposed — not in the code. The surface that slides up from the bottom of a mobile screen and replaces the desktop side panel, popups and modals, in three fixed heights (peek, half, full) or at the height of its content.

## Use

`.mob-sheet` with one height class: `mob-sheet--peek` (height `mobile-sheet-peek`, 96px: the handle and a one-line title), `mob-sheet--half` (50 % of the screen, so the sky map stays usable) or `mob-sheet--full` (100 %). Top corners are `mobile-sheet-radius` (16px). Anatomy: `.mob-sheet-grab` (a full-width button holding `.mob-sheet-handle`, 32px by 4px), `.mob-sheet-header` (title in the `m-title` style) and a scrolling `.mob-sheet-body`.

Use it for everything the desktop shows in a floating panel: the targets list, an object's details, the display settings, a confirmation. `mob-sheet--auto` takes the height of its content up to 60 % of the parent (`mob-sheet--auto-lg`: 70 %); past that the body scrolls. Use it for a short action list (the object sheet) or a checklist. The last row of a sheet body has no separator, so it does not double the tab bar's hairline. A sheet that must be answered (a checklist with Réinitialiser and Appliquer) sits on a `.mob-scrim` and ends with `.mob-sheet-footer`: the buttons side by side, equal widths. A sheet is positioned by its parent: give the parent `position: relative`, and the half and full classes take a percentage of that parent.

## You supply

- A title through `t('...')` and the body content, usually `ListRow`s, fields and `Button`s.
- The state machine: tapping the grab area or dragging it moves peek, half and full; the sheet only styles the three heights.
- A visible close or collapse control in the full state (the keyboard Escape of the desktop is not available): the grab button collapses it, and the header may carry a `.mob-icon-btn` close.
- The bottom safe area: the sheet adds `env(safe-area-inset-bottom)` as bottom padding.

## States

- Peek, half, full as above. The grab area is `mobile-touch-min` (48px) tall, though the handle is 4px.
- Surface: `bg-deep`, `border-panel`, a `shadow-lg` shadow cast upward. The handle is `border-white-xl`.
- Content rows keep their own pressed states; the sheet has no hover state.

## Do / Don't

- Do keep the sky map interactive behind a peek or half sheet.
- Do put the primary action in the sheet body, within reach of the thumb, at `mobile-touch-min` height.
- Don't open a sheet from a sheet; replace its content instead.
- Don't use the desktop `ModalSheet` on mobile, and don't depend on a backdrop click to close.
