# Phone App Mockups

The approved mockups of the phone app (Capacitor + Ionic Vue), 58 screens drawn twice (portrait 412 x 915, landscape 915 x 412). Their source is in `design/mobile/` (see `design/mobile/README.md`); the pictures below are rendered from it. The decisions behind them are in `.claude/work-packages/design/decisions.md`; the claude.ai pages listed there are copies of this source.

## Rules that bind every phone screen

Each line ends with the date the user decided it.

**Navigation**

- Tab order: Ciel, Galerie, Cibles, Plans, Réglages. (2026-10-04)
- The Galerie, Cibles and Plans top bars have no title (search field plus button only); Réglages and the plan detail keep theirs. (2026-10-04)
- No horizontally scrolling chip rows. (2026-10-04)
- The top right of the map holds a ribbon with the desktop's seven map toggles (local sky, azimuth grid, trajectory, terrain horizon, Moon, Sun, planets) and, last, the entry to the full display settings; no eye button on the map. (2026-10-04)
- In landscape the ribbon's buttons stay at the top right and are shown only when opened. (2026-10-05)
- Tapping a photo on the map opens a bottom sheet: its DSOs (three rows at most, a carousel beyond), and buttons for display order, metadata, gallery details and repositioning. (2026-10-04)
- "Placer la photo" and "Identifier les étoiles" are full-screen modes that always show the sky map, whatever screen started them; after Valider the app shows the photo on the Ciel tab. (2026-10-05)
- Identification is reachable from the photo's information, on the sky map and in the gallery. (2026-10-05)

**Sheets**

- The object sheet takes the height of its content. (2026-10-04)
- A scrolling sheet shows a styled scroll bar that is always visible. (2026-10-04)
- Long explanatory texts go behind an "i" button that opens a small sheet; state lines, warnings and the one-line reason of a disabled control stay printed. (2026-10-04)
- The manual placement mode keeps its fixed bottom panel (about a third of the screen). (2026-10-04)
- On the asteroid results screen "Modifier la recherche" is always visible above the footer buttons; only the list scrolls. (2026-10-05)

**Buttons and icons**

- A button has the colour of its desktop role: save and validate are green (`btn-confirm`), action buttons use `btn-action`, danger stays red. (2026-10-04)
- An eye icon means show or hide and nothing else; adding something is a plus button. (2026-10-04)
- Icon-only action buttons have no label; their name shows on a long press, beside the pressed button. (2026-10-05)
- The object sheet's action buttons (add a frame, add to a plan, details) are icon-only; details uses the info icon. (2026-10-04)
- In a search form the search action is a lens icon button at the right end of the input row. (2026-10-04)
- The desktop's meaning colours are used (yellow rating stars, etc.). (2026-10-04)
- Desktop and phone share one look: unticked tick boxes and option circles are drawn dark on both. (2026-10-05)

**Texts**

- A line of explanation is printed only if the desktop prints that text visibly; nothing is invented, and a control that explains itself gets no text. (2026-10-04)
- A value is written as the desktop writes it: same unit, format and decimals (opacity is 0.00 to 1.00). (2026-10-04)
- "Setup" is the word for an equipment setup, in French too. (2026-10-04)
- Wherever a time is entered in UTC, "UTC" is visible next to the field. (2026-10-04)
- Field placeholders are very slightly lighter than before (4.59:1), still dimmer than typed text. (2026-10-04)
- The star and DSO hover-tooltip settings are not on the phone; that information is in the object sheet. (2026-10-04)

**Forms**

- Lists, switches and sliders apply at once; forms and the modes that move something on the map use Annuler / Valider. (2026-10-05)
- Date and time use the phone's native pickers. (2026-10-03)
- Every mode has visible Cancel and Done buttons: no keyboard shortcuts on the phone. (2026-10-03)
- Latitude and longitude sit on one row; there are no named locations. (2026-10-04)
- Star identification takes 2 or 3 stars; "Valider" is enabled from two named stars; a star can also be picked on the sky map. (2026-10-04)

**Deletes and errors**

- Every delete (plan, photo, setup, frame, ...) asks for confirmation in a confirm/cancel popup; a plan has a visible delete button. (2026-10-04)
- The "make a backup first" warning is visible in the import section before a file is chosen. (2026-10-04)
- Errors are red toasts at the bottom. (2026-10-05)
- Start with nothing configured: the normal screens, empty, each with one button to add what is missing; no guided tour. (2026-10-05)
- Regions cannot be renamed, as on the desktop. (2026-10-05)

**Landscape**

- Landscape is included from the start: a navigation rail on the left, sheets of limited width, modes with a settings column on the right. (2026-10-05)
- The status bar and gesture bar areas are part of every screen (24 px each at the top and bottom). (2026-10-05)

## How the phone app gets this look

- The screens are built with Ionic's own components wherever one exists; nothing Ionic provides is rebuilt (2026-10-05).
- The look comes from the design system's stylesheet (`design/mobile/ds/myastrosky/components/bundle.css`, the `.mob-*` classes) and its tokens (`design/mobile/ds/myastrosky/tokens.css`); the Ionic components are themed to it.
- The fonts (Outfit and DM Mono) are bundled in the app. The mockups load them from Google Fonts, so a picture needs a network connection to be drawn in the right font.

## Screens

Pictures are 2x renders of each board at its own size. The landscape title of a board is its title followed by ", paysage". Where a row says "portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12)", the board existed at the approval of 2026-10-04 and its landscape variant was drawn in revision 12. Boards were corrected up to revision 15 after the approval; the pictures show the corrected state.

### Ciel

| Board                              | Portrait                                        | Landscape                                                         | Source                                        | Status                                                                    |
| ---------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------- |
| Ciel                               | [Main.png](mobile/Main.png)                     | [MainLandscape.png](mobile/MainLandscape.png)                     | `design/mobile/boards/Main.dc.html`           | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |
| Ciel, objet sélectionné            | [SkyObject.png](mobile/SkyObject.png)           | [SkyObjectLandscape.png](mobile/SkyObjectLandscape.png)           | `design/mobile/boards/SkyObject.dc.html`      | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |
| Ciel, recherche                    | [SkySearch.png](mobile/SkySearch.png)           | [SkySearchLandscape.png](mobile/SkySearchLandscape.png)           | `design/mobile/boards/SkySearch.dc.html`      | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |
| Ciel, affichage                    | [SkyDisplay.png](mobile/SkyDisplay.png)         | [SkyDisplayLandscape.png](mobile/SkyDisplayLandscape.png)         | `design/mobile/boards/SkyDisplay.dc.html`     | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |
| Ciel, calques de la carte          | [SkyToggles.png](mobile/SkyToggles.png)         | [SkyTogglesLandscape.png](mobile/SkyTogglesLandscape.png)         | `design/mobile/boards/SkyToggles.dc.html`     | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |
| Ciel, nom d'un calque (appui long) | [SkyTogglesHint.png](mobile/SkyTogglesHint.png) | [SkyTogglesHintLandscape.png](mobile/SkyTogglesHintLandscape.png) | `design/mobile/boards/SkyTogglesHint.dc.html` | approved 2026-10-05 (revision 12)                                         |
| Ciel, photo sélectionnée           | [SkyPhoto.png](mobile/SkyPhoto.png)             | [SkyPhotoLandscape.png](mobile/SkyPhotoLandscape.png)             | `design/mobile/boards/SkyPhoto.dc.html`       | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |
| Ciel, cadre sélectionné            | [FrameEdit.png](mobile/FrameEdit.png)           | [FrameEditLandscape.png](mobile/FrameEditLandscape.png)           | `design/mobile/boards/FrameEdit.dc.html`      | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |
| Ciel, déplacer le cadre            | [FrameMove.png](mobile/FrameMove.png)           | [FrameMoveLandscape.png](mobile/FrameMoveLandscape.png)           | `design/mobile/boards/FrameMove.dc.html`      | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |
| Ciel, ordre d'affichage            | [DrawOrder.png](mobile/DrawOrder.png)           | [DrawOrderLandscape.png](mobile/DrawOrderLandscape.png)           | `design/mobile/boards/DrawOrder.dc.html`      | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |
| Ciel, premier démarrage            | [MainFirstStart.png](mobile/MainFirstStart.png) | [MainFirstStartLandscape.png](mobile/MainFirstStartLandscape.png) | `design/mobile/boards/MainFirstStart.dc.html` | approved 2026-10-05 (revision 14)                                         |

### Galerie

| Board                                        | Portrait                                                          | Landscape                                                                           | Source                                                 | Status                                                                    |
| -------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------- |
| Galerie                                      | [Library.png](mobile/Library.png)                                 | [LibraryLandscape.png](mobile/LibraryLandscape.png)                                 | `design/mobile/boards/Library.dc.html`                 | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |
| Galerie, données de l'ordinateur             | [LibraryConnected.png](mobile/LibraryConnected.png)               | [LibraryConnectedLandscape.png](mobile/LibraryConnectedLandscape.png)               | `design/mobile/boards/LibraryConnected.dc.html`        | approved 2026-10-05 (revision 12)                                         |
| Galerie, ajouter une photo                   | [LibraryAdd.png](mobile/LibraryAdd.png)                           | [LibraryAddLandscape.png](mobile/LibraryAddLandscape.png)                           | `design/mobile/boards/LibraryAdd.dc.html`              | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |
| Importer des photos                          | [ImportReview.png](mobile/ImportReview.png)                       | [ImportReviewLandscape.png](mobile/ImportReviewLandscape.png)                       | `design/mobile/boards/ImportReview.dc.html`            | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |
| Importer, méthode de placement               | [ImportMethod.png](mobile/ImportMethod.png)                       | [ImportMethodLandscape.png](mobile/ImportMethodLandscape.png)                       | `design/mobile/boards/ImportMethod.dc.html`            | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |
| Photo                                        | [PhotoDetail.png](mobile/PhotoDetail.png)                         | [PhotoDetailLandscape.png](mobile/PhotoDetailLandscape.png)                         | `design/mobile/boards/PhotoDetail.dc.html`             | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |
| Photo, zoomée                                | [PhotoZoomed.png](mobile/PhotoZoomed.png)                         | [PhotoZoomedLandscape.png](mobile/PhotoZoomedLandscape.png)                         | `design/mobile/boards/PhotoZoomed.dc.html`             | approved 2026-10-05 (revision 12)                                         |
| Photo, informations                          | [PhotoInfo.png](mobile/PhotoInfo.png)                             | [PhotoInfoLandscape.png](mobile/PhotoInfoLandscape.png)                             | `design/mobile/boards/PhotoInfo.dc.html`               | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |
| Photo, modifier les infos                    | [PhotoEdit.png](mobile/PhotoEdit.png)                             | [PhotoEditLandscape.png](mobile/PhotoEditLandscape.png)                             | `design/mobile/boards/PhotoEdit.dc.html`               | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |
| Placer la photo                              | [Placement.png](mobile/Placement.png)                             | [PlacementLandscape.png](mobile/PlacementLandscape.png)                             | `design/mobile/boards/Placement.dc.html`               | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |
| Identifier les étoiles                       | [ThreePoint.png](mobile/ThreePoint.png)                           | [ThreePointLandscape.png](mobile/ThreePointLandscape.png)                           | `design/mobile/boards/ThreePoint.dc.html`              | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |
| Identifier les étoiles, choisir une étoile   | [ThreePointSearch.png](mobile/ThreePointSearch.png)               | [ThreePointSearchLandscape.png](mobile/ThreePointSearchLandscape.png)               | `design/mobile/boards/ThreePointSearch.dc.html`        | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |
| Identifier les étoiles, choisir sur la carte | [ThreePointMap.png](mobile/ThreePointMap.png)                     | [ThreePointMapLandscape.png](mobile/ThreePointMapLandscape.png)                     | `design/mobile/boards/ThreePointMap.dc.html`           | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |
| Identifier un astéroïde                      | [IdentifyAsteroid.png](mobile/IdentifyAsteroid.png)               | [IdentifyAsteroidLandscape.png](mobile/IdentifyAsteroidLandscape.png)               | `design/mobile/boards/IdentifyAsteroid.dc.html`        | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |
| Astéroïdes trouvés                           | [IdentifyAsteroidResults.png](mobile/IdentifyAsteroidResults.png) | [IdentifyAsteroidResultsLandscape.png](mobile/IdentifyAsteroidResultsLandscape.png) | `design/mobile/boards/IdentifyAsteroidResults.dc.html` | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |
| Identifier des supernovae                    | [IdentifySupernova.png](mobile/IdentifySupernova.png)             | [IdentifySupernovaLandscape.png](mobile/IdentifySupernovaLandscape.png)             | `design/mobile/boards/IdentifySupernova.dc.html`       | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |
| Identifier des comètes                       | [IdentifyComet.png](mobile/IdentifyComet.png)                     | [IdentifyCometLandscape.png](mobile/IdentifyCometLandscape.png)                     | `design/mobile/boards/IdentifyComet.dc.html`           | approved 2026-10-05 (revision 14)                                         |
| Galerie, aucune photo                        | [LibraryEmpty.png](mobile/LibraryEmpty.png)                       | [LibraryEmptyLandscape.png](mobile/LibraryEmptyLandscape.png)                       | `design/mobile/boards/LibraryEmpty.dc.html`            | approved 2026-10-05 (revision 14)                                         |
| Galerie, résolutions en cours                | [LibrarySolving.png](mobile/LibrarySolving.png)                   | [LibrarySolvingLandscape.png](mobile/LibrarySolvingLandscape.png)                   | `design/mobile/boards/LibrarySolving.dc.html`          | approved 2026-10-05 (revision 14)                                         |
| Importer, résolution échouée                 | [ImportSolveFailed.png](mobile/ImportSolveFailed.png)             | [ImportSolveFailedLandscape.png](mobile/ImportSolveFailedLandscape.png)             | `design/mobile/boards/ImportSolveFailed.dc.html`       | approved 2026-10-05 (revision 14)                                         |
| Importer, hors connexion                     | [SolveOffline.png](mobile/SolveOffline.png)                       | [SolveOfflineLandscape.png](mobile/SolveOfflineLandscape.png)                       | `design/mobile/boards/SolveOffline.dc.html`            | approved 2026-10-05 (revision 14)                                         |

### Cibles

| Board                   | Portrait                                        | Landscape                                                         | Source                                        | Status                                                                    |
| ----------------------- | ----------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------- |
| Cibles                  | [Targets.png](mobile/Targets.png)               | [TargetsLandscape.png](mobile/TargetsLandscape.png)               | `design/mobile/boards/Targets.dc.html`        | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |
| Cibles, types d'objets  | [TargetsTypes.png](mobile/TargetsTypes.png)     | [TargetsTypesLandscape.png](mobile/TargetsTypesLandscape.png)     | `design/mobile/boards/TargetsTypes.dc.html`   | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |
| Cibles, filtres         | [TargetsFilter.png](mobile/TargetsFilter.png)   | [TargetsFilterLandscape.png](mobile/TargetsFilterLandscape.png)   | `design/mobile/boards/TargetsFilter.dc.html`  | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |
| Dessiner une région     | [RegionDraw.png](mobile/RegionDraw.png)         | [RegionDrawLandscape.png](mobile/RegionDrawLandscape.png)         | `design/mobile/boards/RegionDraw.dc.html`     | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |
| Cibles, régions du ciel | [Regions.png](mobile/Regions.png)               | [RegionsLandscape.png](mobile/RegionsLandscape.png)               | `design/mobile/boards/Regions.dc.html`        | approved 2026-10-05 (revision 14)                                         |
| Cibles, aucun setup     | [TargetsNoSetup.png](mobile/TargetsNoSetup.png) | [TargetsNoSetupLandscape.png](mobile/TargetsNoSetupLandscape.png) | `design/mobile/boards/TargetsNoSetup.dc.html` | approved 2026-10-05 (revision 14)                                         |
| Cibles, aucun résultat  | [TargetsNoMatch.png](mobile/TargetsNoMatch.png) | [TargetsNoMatchLandscape.png](mobile/TargetsNoMatchLandscape.png) | `design/mobile/boards/TargetsNoMatch.dc.html` | approved 2026-10-05 (revision 14)                                         |

### Plans

| Board                       | Portrait                                  | Landscape                                                   | Source                                     | Status                                                                    |
| --------------------------- | ----------------------------------------- | ----------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------- |
| Plans                       | [Plans.png](mobile/Plans.png)             | [PlansLandscape.png](mobile/PlansLandscape.png)             | `design/mobile/boards/Plans.dc.html`       | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |
| Détail du plan              | [PlanDetail.png](mobile/PlanDetail.png)   | [PlanDetailLandscape.png](mobile/PlanDetailLandscape.png)   | `design/mobile/boards/PlanDetail.dc.html`  | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |
| Plan, actions               | [PlanActions.png](mobile/PlanActions.png) | [PlanActionsLandscape.png](mobile/PlanActionsLandscape.png) | `design/mobile/boards/PlanActions.dc.html` | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |
| Plan, détail d'une cible    | [PlanEntry.png](mobile/PlanEntry.png)     | [PlanEntryLandscape.png](mobile/PlanEntryLandscape.png)     | `design/mobile/boards/PlanEntry.dc.html`   | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |
| Plan, fenêtre d'observation | [ObsWindow.png](mobile/ObsWindow.png)     | [ObsWindowLandscape.png](mobile/ObsWindowLandscape.png)     | `design/mobile/boards/ObsWindow.dc.html`   | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |
| Plans, aucun plan           | [PlansEmpty.png](mobile/PlansEmpty.png)   | [PlansEmptyLandscape.png](mobile/PlansEmptyLandscape.png)   | `design/mobile/boards/PlansEmpty.dc.html`  | approved 2026-10-05 (revision 14)                                         |

### Réglages

| Board                              | Portrait                                                | Landscape                                                                 | Source                                            | Status                                                                    |
| ---------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------- |
| Réglages                           | [Settings.png](mobile/Settings.png)                     | [SettingsLandscape.png](mobile/SettingsLandscape.png)                     | `design/mobile/boards/Settings.dc.html`           | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |
| Réglages, connexion à l'ordinateur | [LanPairing.png](mobile/LanPairing.png)                 | [LanPairingLandscape.png](mobile/LanPairingLandscape.png)                 | `design/mobile/boards/LanPairing.dc.html`         | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |
| Réglages, ordinateur connecté      | [LanConnected.png](mobile/LanConnected.png)             | [LanConnectedLandscape.png](mobile/LanConnectedLandscape.png)             | `design/mobile/boards/LanConnected.dc.html`       | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |
| Réglages, setups                   | [GearSetups.png](mobile/GearSetups.png)                 | [GearSetupsLandscape.png](mobile/GearSetupsLandscape.png)                 | `design/mobile/boards/GearSetups.dc.html`         | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |
| Équipement, modifier le setup      | [GearSetupEdit.png](mobile/GearSetupEdit.png)           | [GearSetupEditLandscape.png](mobile/GearSetupEditLandscape.png)           | `design/mobile/boards/GearSetupEdit.dc.html`      | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |
| Équipement, choisir un télescope   | [GearPicker.png](mobile/GearPicker.png)                 | [GearPickerLandscape.png](mobile/GearPickerLandscape.png)                 | `design/mobile/boards/GearPicker.dc.html`         | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |
| Réglages, lieu d'observation       | [Location.png](mobile/Location.png)                     | [LocationLandscape.png](mobile/LocationLandscape.png)                     | `design/mobile/boards/Location.dc.html`           | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |
| Lieu, horizon indisponible         | [HorizonUnavailable.png](mobile/HorizonUnavailable.png) | [HorizonUnavailableLandscape.png](mobile/HorizonUnavailableLandscape.png) | `design/mobile/boards/HorizonUnavailable.dc.html` | approved 2026-10-05 (revision 14)                                         |
| Lieu, position refusée             | [LocationDenied.png](mobile/LocationDenied.png)         | [LocationDeniedLandscape.png](mobile/LocationDeniedLandscape.png)         | `design/mobile/boards/LocationDenied.dc.html`     | approved 2026-10-05 (revision 14)                                         |
| Réglages, exporter et importer     | [Backup.png](mobile/Backup.png)                         | [BackupLandscape.png](mobile/BackupLandscape.png)                         | `design/mobile/boards/Backup.dc.html`             | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |

### Feuilles et dialogues partagés

| Board                               | Portrait                                        | Landscape                                                         | Source                                        | Status                                                                    |
| ----------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------- |
| Plan, confirmer la suppression      | [ConfirmDelete.png](mobile/ConfirmDelete.png)   | [ConfirmDeleteLandscape.png](mobile/ConfirmDeleteLandscape.png)   | `design/mobile/boards/ConfirmDelete.dc.html`  | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |
| Identification, explication ouverte | [IdentifyInfo.png](mobile/IdentifyInfo.png)     | [IdentifyInfoLandscape.png](mobile/IdentifyInfoLandscape.png)     | `design/mobile/boards/IdentifyInfo.dc.html`   | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |
| Photo, choisir une identification   | [IdentifyChoose.png](mobile/IdentifyChoose.png) | [IdentifyChooseLandscape.png](mobile/IdentifyChooseLandscape.png) | `design/mobile/boards/IdentifyChoose.dc.html` | portrait approved 2026-10-04; landscape approved 2026-10-05 (revision 12) |

## As built

Filled in by the phone work: one row per screen once it is built and checked on a device.

| Screen | Date | Device picture | Differences from the mockup | Status |
| ------ | ---- | -------------- | --------------------------- | ------ |
|        |      |                |                             |        |

### Known correction not yet drawn

- On "Ciel, nom d'un calque (appui long)" (portrait and landscape), the name shown by a long press must sit beside the pressed button (decision of 2026-10-05).
