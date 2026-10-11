# WP6.1a and WP6.1b — The phone's shared components, then the Réglages tab

Model: sonnet for both · Branch: `mobile/phase-3b` · One sub-card at a time, one commit each · Depends on: WP6.0b · Needs device: no

Each worker reads `.claude/work-packages/phase-6/WP6-common.md`, `.claude/work-packages/phase-3/WP3-common.md`, then this file, and runs the sub-card named in its instructions.

---

## WP6.1a — The shared phone components

### Goal

The frame's pages use plain elements with the design system's classes for buttons, search fields and rows. The user asked for Ionic's own components wherever one exists. Build the small set of shared components every screen will use, each an Ionic component carrying the approved look, and switch the five existing pages to them. Nothing new appears on screen.

### Steps

1. Read every board once (pictures first, `.playwright-mcp/mobile-boards/*.png`, then the HTML of the ones that introduce an element) and list the distinct elements the boards use: buttons (action, confirm/green, danger, icon-only, with their sizes), search field with its side button, list rows (plain, with value and chevron, with a switch, with a slider, with a leading icon, reorderable), section titles, sheets (header with title and close, footer with Annuler / Valider), the confirm dialog (board "Plan, confirmer la suppression"), the red error toast, chips and type badges, the empty state (text and one button), the loading state ("Résolution" with its spinner is one case), text and number fields with their unit outside the field, the "i" information button and its sheet (board "Identification, explication ouverte"), the long-press name beside an icon button.
2. For each, one component in `apps/mobile/src/components/` built on the matching Ionic component (`IonButton`, `IonSearchbar` or `IonInput`, `IonItem`, `IonListHeader`, `IonModal`, `IonAlert`, `IonToast`, `IonChip`, `IonToggle`, `IonRange`, `IonSpinner`, `IonReorder`…), with the look set once in `apps/mobile/src/theme/` through Ionic's CSS variables and shadow parts, from the design system's tokens. Where the design system's class already gives the exact look and can be put on the Ionic host element, do that rather than duplicating its rules. Props are few and typed; no component takes a free "style" or "class for the inside".
   - `useConfirm()` (returns a promise of yes/no; the dialog of the board), `useErrorToast()` (red toast at the bottom; takes an `Error` and shows its message), `useLongPressLabel` (the name beside the pressed button), a sheet wrapper whose height is its content's and which the back button closes.
3. A gallery page reachable only in development builds (`/dev/components`, not in the tab bar, excluded from the production build) showing every component in every state, used for the checks and for later reviews.
4. Switch the five pages of the frame to these components. They must look the same as before on the board comparison, or closer.
5. Checks of `WP6-common.md`, on the gallery page and the five pages. For each component: compare with the board that introduces it (name the board), measuring height, padding, radius, font, colours in normal, pressed and disabled states, and the touch area.

### Commit

`internal(mobile): build the phone screens from Ionic components with the approved look`

### Report

The table: element · board that shows it · component · Ionic component under it · differences that remain · elements of the boards for which no Ionic component fits.

---

## WP6.1b — The Réglages tab

### Goal

Make the Réglages tab real, from its boards: "Réglages", "Réglages, setups", "Équipement, modifier le setup", "Équipement, choisir un télescope", "Réglages, lieu d'observation", "Lieu, horizon indisponible", "Lieu, position refusée", "Réglages, exporter et importer". The two boards about the connection to a computer are a later card: their row is built disabled.

### Steps

1. **Catalogues at start-up.** The gear lists and the deep-sky and star registries must be loaded on the phone as the desktop's start-up does (`src/main.ts`, `src/dso-catalog.ts`, `src/star-catalog.ts`: the loaders call the core registries' setters). Put the phone's loaders in `apps/mobile/src/` (or share the desktop's loader if it is pure enough to move to `packages/app-state`; prefer sharing), loading after the first screen is shown so that start-up stays fast, with the screens that need them waiting on one promise.
2. **Réglages (the list).** Every row of the board with its real value (number of setups, the location as coordinates, the language, the app's version, and the others the board shows). A row whose board is not built in this card, or whose value needs something not built, is disabled as `WP6-common.md` says.
3. **Setups.** The list (enable switch, edit, delete with confirmation, add), the editor (name, telescope, camera, accessories, filters… as the board shows, Annuler / Valider), the picker of a telescope and of the other gear kinds (search, list, the board's rows; adding custom gear only if a board shows it). Logic: `packages/core/src/gear-catalog.ts`, `setup-info.ts`, `gear-presets.ts`, the data functions for setups and custom gear. What the desktop's setup window computes or validates (`src/fov-overlay.ts`, `buildSetupModal` and around, and `src/targets-view.ts` gear windows) and that the phone needs: extract to core as `WP6-common.md` says.
4. **Lieu d'observation.** Latitude and longitude on the same row, "my location" through the Geolocation plugin (`@capacitor/geolocation`, added to `apps/mobile` only; coordinates only, no named place), the horizon part as the board shows (compute through the horizon data function, the states of the two boards "horizon indisponible" and "position refusée"). The location and the horizon settings are stored through the same core modules and keys as the desktop (`targets-prefs-v3`, `sky-time-settings`, `horizon-settings-v1`); where that logic sits in a desktop store (`src/stores/horizon.ts`, `src/stores/sky-time.ts`), extract the part that is not about the desktop's map into `packages/app-state` and make the desktop store use it.
5. **Exporter et importer.** Export through the backup data function (the phone's backend opens the share sheet). Import: pick a file (`@capawesome/capacitor-file-picker`, added to `apps/mobile` only), the preview and the choices as the board shows (what to restore; for a setup or a plan that already exists, the same three choices as the desktop: replace, keep both, do not import, if the board shows them: if it does not, stop and report), the result, the items that failed. Keyboard shortcuts are not offered on the phone. The warning to make a backup before importing: only if the board shows it.
6. In a desktop browser the two plugins do not exist: location falls back to the browser's geolocation and the file to a file input, behind the one platform function of the frame, so that the screens can be checked in the phone-sized browser.
7. Checks of `WP6-common.md` for every screen and sheet of this card.

### Must NOT

- Build the connection-to-a-computer screens, the theme chooser if no board shows one, or anything of another tab.
- Add a plugin other than the two named.

### Commit

`feat(mobile): settings, setups, observing location and backup on the phone`

### Report

As `WP6-common.md` asks, plus: the plugins added and their versions; the Android permissions added to the manifest and why; what was extracted from the desktop's stores.
