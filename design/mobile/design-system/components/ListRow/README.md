Proposed — not in the code. The tappable list row of the mobile app: a leading icon, a title with a secondary line, and a trailing value or chevron.

## Use

`.mob-row` is a full-width `<button>` (or link) holding up to three parts: `.mob-row-lead` (a 40px circular icon well), `.mob-row-body` (`.mob-row-title` in the `m-body` style over `.mob-row-sub` in the `m-secondary` style) and `.mob-row-trail` (a value in `m-mono` or `m-secondary`, or a `.mob-row-chevron` `▶`). Use it for target results, plans, photos and settings. The row replaces the desktop target card and the side-panel rows on mobile.

## You supply

- The texts, ellipsised on one line each: name from `displayName`, then catalogue id, type and constellation code.
- An optional leading icon from `assets/Icons` (inline, `currentColor`).
- A trailing value (an altitude, a count) or a chevron when the row opens a detail screen. Never both. A checklist row is a `<label class="mob-row">` with a trailing native `.mob-check` (24px): the row is the tap target.
- For a target row, a `.mob-meta` line: the catalogue id, then the desktop's colour-coded badges, `.mob-badge--type` (`target-type-bg`, `text-secondary` text: the desktop `text-dim` fails 4.5:1, see batch 2a revision 3) and `.mob-badge--const` (the `target-const-*` green), in `m-caption`; text on one baseline. The rating is `★`/`☆` in `.mob-rating` (`target-rating-text`). A status value takes the `status-*` text colour (`.mob-status--success`) with a `✓`. Colour only what the desktop colours.
- The tap handler; the whole row is the target.

## States

- Minimum height `mobile-list-row-min` (56px) with `mobile-gutter` side padding and a `border-subtle` separator; the row never shrinks below `mobile-touch-min`.
- Rest: transparent. Pressed: fill `bg-hover` (there is no hover state).
- Title `text-primary`, secondary line and trailing text `text-secondary`; keyboard focus is a 2px `text-bright` ring inside the row.

## Do / Don't

- Do keep information in the row itself: a value that the desktop shows on hover goes in the secondary line or the trailing value.
- Do group rows in a `bg-panel` list or a sheet body.
- Don't put a second tappable control inside a row; a row with a checkbox makes the checkbox the trailing element and the row the toggle.
- Don't wrap text to more than two lines; truncate with an ellipsis.
