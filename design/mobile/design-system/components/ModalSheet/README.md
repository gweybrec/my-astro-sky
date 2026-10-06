The large summoned surface of the desktop app: a `.modal` box over a dimmed backdrop, widened by `modal-sheet` to 95vw by up to 90vh for content that needs room, such as the Find-targets overlay.

## Use

Use a modal when a large body of content or an input needs focused attention and cannot fit in a floating panel. Anatomy: `.modal-backdrop` > `.modal` (+ one sizing class, here `.modal-sheet`) > `.modal-header` (title `h2` and a `.modal-close` ×) + `.modal-body` (scrolls) + `.modal-footer` (right-aligned buttons, or `.modal-footer-grid2` for two equal columns). Put form content in `.modal-form-body`.

For a yes/no prompt of two sentences and two buttons use the confirmation dialog (`.dialog`, not built here). For a small info blurb use a click tooltip, not a modal.

## You supply

- The title and body content, text through `t('...')`; `role="dialog"`, `aria-modal="true"` and `aria-labelledby`.
- The footer buttons: cancel then confirm (`Button`).
- The open/close logic. The × is always present; Escape closes a modal with no unsaved form state.

## States

- Backdrop: `bg-overlay` at `z-modal`; clicking it does nothing.
- Box: `bg-deep`, `border-panel`, `radius-xl`; header and footer stay fixed, the body scrolls.
- Close button: × at 24px, `text-primary`, hover fill `accent-fill-lg`.
- Loading and error placeholders: `.modal-loading-placeholder` (`text-muted`), `.modal-loading-error` (`status-error-text`).

## Do / Don't

- Do add one sizing class next to `.modal`; never set max-width or max-height inline.
- Do keep the close × and the footer visible at all times.
- Don't close a modal on backdrop click, and don't open a modal inside a modal.
- Don't use this on the mobile layer: summoned surfaces become a `BottomSheet`.
