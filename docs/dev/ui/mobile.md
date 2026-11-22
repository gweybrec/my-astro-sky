# Phone UI Rules

The rules every screen of the phone app (`apps/mobile/`) follows. The desktop's rules are in the other chapters of [the UI guidelines](../ui-guidelines.md); the two apps share one look.

## Building a screen

- Use Ionic's own components wherever one exists, through the shared components of `apps/mobile/src/components/`. Do not rebuild from plain elements what Ionic provides.
- Colours, sizes, fonts and spacing come from the design system's tokens (`apps/mobile/src/theme/design-system/`). A screen does not restyle an Ionic component itself.
- The app's `bundle.css` holds only the part of the design system's stylesheet that the app uses. The design system's own stylesheet, which the mockups load, is larger: it also carries the desktop's classes (buttons, target cards, modals of the desktop), the classes of what Ionic draws in the app (tabs, switches, selects, dialogs, toasts, whose look the app gives through `phone-components.css` and `ionic-tokens.css`), the drawings over a picture of the map that the app draws on its canvas (field-of-view frames, photo outlines, stars to pick), and what only makes a mockup look like a phone (status bar, keyboard). A class is copied into the app when an element of the app first carries it; `apps/mobile/tests/design-system-classes.test.ts` fails on a class of `bundle.css` that no element carries.
- Every text goes through `t('…')`, in the four languages. A text that exists on the desktop reuses its key.
- A screen holds no rule of the domain: data comes from `@myastrosky/app-state`, computation from `@myastrosky/core`. Logic needed from a desktop module is moved to a shared package first, and the desktop calls the shared version.

## Layout and alignment

- A phone is 360 to 430 CSS pixels wide. Fixed sizes and margins are constants; flexible elements take the remaining width; nothing is scaled or clipped. Landscape has its own layout: a navigation rail on the left, sheets of limited width.
- The frame applies the system bars' insets once. A screen never reads `env(safe-area-inset-*)`.
- **Alignment comes from layout.** Items line up because of how their row arranges them (`align-items`, `gap`, grid tracks). Text beside a chip shares the baseline of the text inside the chip. An icon is aligned by its row and sized by a token or in `em`.
- **No pixel offsets.** No literal length in a position, margin, transform or fixed height may be used to bring something into line: it would break when the text wraps, grows or is translated. `apps/mobile/scripts/check-no-nudges.mjs` runs in `npm run verify` and fails on them, and on a raw length in a size (`font-size`, `width`, `flex`, Ionic's `--width`…): sizes come from a token or a named variable in `ionic-tokens.css`.
- Trailing items of a row (information button, switch, chevron, handle) are separated by the spacing token; they never touch.
- **Vertical spacing is set by the pair of elements, never per screen.** The gap between two stacked elements comes from the design system's stylesheet, by what the two elements are; a new pair gets its value in the design system (its README, "Vertical spacing") before a screen uses it:
  - a sheet's title and its sub-line (`.mob-meta`): `--space-2`;
  - a sheet's title and a field in its header (a search field, `.mob-sheet-header > .mob-form-row`): `--space-4`;
  - a sheet's header and its body: `--space-4`;
  - a section header: `--space-7` above, `--space-2` below;
  - a field's label and the field: `--space-2`; one form row and the next: `--space-4`;
  - facts: `--space-4` between lines, `--space-9` between two facts on a line.
- Every touch area is at least 48 by 48 CSS pixels. A secondary button, one that is not among a screen's main controls and sits inside a row whose main controls keep that size (the compact icon button, `PhoneIconButton compact`: an exposure row's "+" filter), is at least 32 by 32 CSS pixels, the size of the compact chips.

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

## A photo's exposures

- Wherever a photo's facts are listed (the map's photo sheet, the gallery's information sheet), the exposures (`Intégration`) take a full line of their own: one line per exposure row, its time first (`40 × 300 s`, `N/A × 120 s`, `183 × N/A`), then its filter as a coloured badge (`PhoneFilterBadge`); a row with only a filter shows its badge alone. Filter names are often long, so they are never squeezed among the short facts.
- In the edit form, a row's numbers come first and its filter on the line under them: "Filtres", the filter's badge and a compact "+" that opens the list of filters (recently used first, then all of them, with a search). There is no text field for the filter. A row may leave any field empty, but not all three.

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
