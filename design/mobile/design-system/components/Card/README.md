The self-contained content block of MyAstroSky: `bg-card` fill, 1px `border-panel` border, small radius, used for target results and inline data panels.

## Use

- `target-card`: a result in the Targets view. Header (`target-card-header`) holds a title row (name + catalogue id span + star rating) and a chips row (type badge, uppercase constellation code), then the metadata below.
- `dso-info-panel`: an inline data panel in the side panel (name plus label/value rows).
- Other cards in the app share the same base (`batch-item-card`, `photo-section`): `bg-card`, `border-panel`, `radius-md`.

## You supply

- Card content from the catalogue data: `displayName` (per language), catalogue id, rating as `★` and `☆` out of five, difficulty as `◆` and `◇`, type label and constellation code.
- Text through `t('...')`; the card has no copy of its own.
- The card's width: it fills its container.

## States

- Rest: `bg-card`, `border-panel`, `radius-xl` on `target-card` (`radius-md` on `dso-info-panel`).
- Hover (`target-card` only): the border becomes `border-accent`. Hover is cosmetic; nothing is revealed on hover.
- Title: `text-bright`, 15px, 600, single line with an ellipsis; catalogue id `text-label`; rating `target-rating-text`; difficulty `target-difficulty-text`.

## Do / Don't

- Do keep one rating and one difficulty scale (five symbols, filled then empty).
- Do reuse the type and constellation badge classes for those two values.
- Don't nest a card in a card, and don't recolour the border for emphasis.
- Don't rely on the title being fully visible: the ellipsis cuts long names; put the full text in a `title` attribute.
- On mobile use a card at `mobile-card-radius` or a `ListRow`, and make the whole card the tap target.
