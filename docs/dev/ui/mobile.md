# Phone UI Rules

The rules every screen of the phone app (`apps/mobile/`) follows. The desktop's rules are in the other chapters of [the UI guidelines](../ui-guidelines.md); the two apps share one look.

## Building a screen

- Use Ionic's own components wherever one exists, through the shared components of `apps/mobile/src/components/`. Do not rebuild from plain elements what Ionic provides.
- Colours, sizes, fonts and spacing come from the design system's tokens (`apps/mobile/src/theme/design-system/`). A screen does not restyle an Ionic component itself.
- Every text goes through `t('…')`, in the four languages. A text that exists on the desktop reuses its key.
- A screen holds no rule of the domain: data comes from `@myastrosky/app-state`, computation from `@myastrosky/core`. Logic needed from a desktop module is moved to a shared package first, and the desktop calls the shared version.

## Layout and alignment

- A phone is 360 to 430 CSS pixels wide. Fixed sizes and margins are constants; flexible elements take the remaining width; nothing is scaled or clipped. Landscape has its own layout: a navigation rail on the left, sheets of limited width.
- The frame applies the system bars' insets once. A screen never reads `env(safe-area-inset-*)`.
- **Alignment comes from layout.** Items line up because of how their row arranges them (`align-items`, `gap`, grid tracks). Text beside a chip shares the baseline of the text inside the chip. An icon is aligned by its row and sized by a token or in `em`.
- **No pixel offsets.** No literal length in a position, margin, transform or fixed height may be used to bring something into line: it would break when the text wraps, grows or is translated. `apps/mobile/scripts/check-no-nudges.mjs` runs in `npm run verify` and fails on them, and on a raw length in a size (`font-size`, `width`, `flex`, Ionic's `--width`…): sizes come from a token or a named variable in `ionic-tokens.css`.
- Trailing items of a row (information button, switch, chevron, handle) are separated by the spacing token; they never touch.
- Every touch area is at least 48 by 48 CSS pixels.

## Navigation

- Tab order: Ciel, Galerie, Cibles, Plans, Réglages.
- The top bars of Galerie, Cibles and Plans have no title, only a search field and its button. Réglages and the sub-pages have a title.
- The Android back button closes the top-most dialog or sheet, else goes back one page, else, on a tab's first page, leaves the app.
- No row of chips that scrolls sideways.
- There are no keyboard shortcuts on the phone.

## Sheets and dialogs

- A sheet takes the height of its content.
- A sheet closes when dragged down from its header, when its backdrop is tapped, and with the back button; it has no close button. On a sheet with Annuler / Valider this is the same as Annuler.
- A sheet whose content scrolls shows a styled scroll bar that stays visible.
- A long explanation goes behind an "i" button that opens a small sheet. State lines, warnings and the one-line reason of a disabled control stay printed.

## Buttons and icons

- A button has the colour of its role: save and validate are green, other actions use the action colour, danger is red.
- An eye icon means show or hide and nothing else. Adding something is a plus button.
- An icon-only action button has no label; its name shows beside it on a long press.
- In a search form the search action is a lens button at the end of the field's row.

## Texts

- Print a line of explanation only if the desktop prints it. Nothing is invented, and a control that explains itself gets no text.
- Write a value as the desktop writes it: same unit, format and decimals.
- "Setup" is the word for an equipment setup, in French too.
- Wherever a time is entered in UTC, "UTC" is visible next to the field.
- A unit sits outside its field.

## Forms

- Lists, switches and sliders apply at once. Forms, and the modes that move something on the map, use Annuler / Valider.
- Date and time use the phone's own pickers.
- Latitude and longitude sit on one row; a location is a pair of coordinates, not a named place.

## Deletes and errors

- Every delete or clear asks for confirmation in a dialog.
- An error is a red toast at the bottom of the screen.
- A screen with no data shows its normal layout, empty, with one button to add what is missing.
- Importing a backup: when a setup or a plan already exists with different content, the user chooses between replacing it, keeping both, and not importing it.
