Small uppercase monospace tags: removable entity chips (`tag-chip`), the compact photo-list chip (`tag-chip-sm`) and the fixed-colour filter chips.

## Use

Three flavours; do not mix them.

- Entity chips, removable: `tag-chip` (amber outline) for a DSO id attached to a photo, `tag-chip label-chip` (soft red) for a user label, `tag-chip setup-chip` (green) for a gear setup. Anatomy is exactly `<span class="tag-chip">` + label text + `<button class="tag-chip-remove">×</button>`.
- Compact chip: `tag-chip-sm`, transparent with an `accent-fill-lg` border, for lists where chips are read only.
- Filter chips: `target-filter-badge` plus one `.filter-l|r|g|b|rgb|ha|oiii|sii|custom|dual-band`. Colour is tied to the filter type and must look identical wherever it appears.

## You supply

- Chip text as data (DSO id, label, setup name); it is uppercased by the class.
- The remove button's `aria-label` ("Retirer") and its click handler.
- For filter chips, the filter key that selects the class.

## States

- Rest: `tag-chip` is `bg-hover` fill, `accent-fill-lg` border, `text-label` mono 10px, `radius-xs`.
- The remove glyph is `text-primary` and turns `btn-danger-hover-text` on hover.
- Chips have no disabled or selected state; selection chips of the targets form are a different component.

## Do / Don't

- Do reproduce the chip markup identically in Vue templates and in imperative DOM code.
- Do add `--filter-name`, `--filter-name-text` and `--filter-name-border` tokens and a `.filter-name` class for a new filter type.
- Don't restyle a chip with one-off utilities or replace the remove button with hand-rolled classes.
- Don't apply a filter colour inline.
- On mobile the 10px chip text is below the 12px caption floor: use chips for display only and put real actions in a `ListRow` or a button of `mobile-touch-min` height.
