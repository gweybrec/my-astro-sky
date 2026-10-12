# Phone App Mockups

The mockups of the phone app (Capacitor + Ionic Vue) are on the project's Claude Design page, not in this repository: 58 screens, each drawn in portrait (412 x 915) and in landscape (915 x 412). This page holds the rules every phone screen follows and the list of screens. The stylesheet and tokens the app ships are in `apps/mobile/src/theme/design-system/`.

## Rules that bind every phone screen

**Navigation**

- Tab order: Ciel, Galerie, Cibles, Plans, Réglages.
- The Galerie, Cibles and Plans top bars have no title (search field plus button only); Réglages and the plan detail keep theirs.
- No horizontally scrolling chip rows.
- The top right of the map holds a ribbon with the desktop's seven map toggles (local sky, azimuth grid, trajectory, terrain horizon, Moon, Sun, planets) and, last, the entry to the full display settings; no eye button on the map.
- In landscape the ribbon's buttons stay at the top right and are shown only when opened.
- Tapping a photo on the map opens a bottom sheet: its DSOs (three rows at most, a carousel beyond), and buttons for display order, metadata, gallery details and repositioning.
- "Placer la photo" and "Identifier les étoiles" are full-screen modes that always show the sky map, whatever screen started them; after Valider the app shows the photo on the Ciel tab.
- Identification is reachable from the photo's information, on the sky map and in the gallery.

**Sheets**

- The object sheet takes the height of its content.
- A scrolling sheet shows a styled scroll bar that is always visible.
- Long explanatory texts go behind an "i" button that opens a small sheet; state lines, warnings and the one-line reason of a disabled control stay printed.
- The manual placement mode keeps its fixed bottom panel (about a third of the screen).
- On the asteroid results screen "Modifier la recherche" is always visible above the footer buttons; only the list scrolls.

**Buttons and icons**

- A button has the colour of its desktop role: save and validate are green (`btn-confirm`), action buttons use `btn-action`, danger stays red.
- An eye icon means show or hide and nothing else; adding something is a plus button.
- Icon-only action buttons have no label; their name shows on a long press, beside the pressed button.
- The object sheet's action buttons (add a frame, add to a plan, details) are icon-only; details uses the info icon.
- In a search form the search action is a lens icon button at the right end of the input row.
- The desktop's meaning colours are used (yellow rating stars, etc.).
- Desktop and phone share one look: unticked tick boxes and option circles are drawn dark on both.

**Texts**

- A line of explanation is printed only if the desktop prints that text visibly; nothing is invented, and a control that explains itself gets no text.
- A value is written as the desktop writes it: same unit, format and decimals (opacity is 0.00 to 1.00).
- "Setup" is the word for an equipment setup, in French too.
- Wherever a time is entered in UTC, "UTC" is visible next to the field.
- Field placeholders are very slightly lighter than before (4.59:1), still dimmer than typed text.
- The star and DSO hover-tooltip settings are not on the phone; that information is in the object sheet.

**Forms**

- Lists, switches and sliders apply at once; forms and the modes that move something on the map use Annuler / Valider.
- Date and time use the phone's native pickers.
- Every mode has visible Cancel and Done buttons: no keyboard shortcuts on the phone.
- Latitude and longitude sit on one row; there are no named locations.
- Star identification takes 2 or 3 stars; "Valider" is enabled from two named stars; a star can also be picked on the sky map.

**Deletes and errors**

- Every delete (plan, photo, setup, frame,...) asks for confirmation in a confirm/cancel popup; a plan has a visible delete button.
- The "make a backup first" warning is visible in the import section before a file is chosen.
- Errors are red toasts at the bottom.
- Start with nothing configured: the normal screens, empty, each with one button to add what is missing; no guided tour.
- Regions cannot be renamed, as on the desktop.

**Landscape**

- Landscape is included from the start: a navigation rail on the left, sheets of limited width, modes with a settings column on the right.
- The status bar and gesture bar areas are part of every screen (24 px each at the top and bottom).

## How the phone app gets this look

- The screens are built with Ionic's own components wherever one exists; nothing Ionic provides is rebuilt.
- The look comes from the design system's stylesheet (`apps/mobile/src/theme/design-system/`, the `.mob-*` classes) and its tokens; the Ionic components are themed to it.
- The fonts (Outfit and DM Mono) are bundled in the app. The mockups load them from Google Fonts, so a picture needs a network connection to be drawn in the right font.

## Screens

The titles are those of the mockups.

### Ciel

- Ciel
- Ciel, objet sélectionné
- Ciel, recherche
- Ciel, affichage
- Ciel, calques de la carte
- Ciel, nom d'un calque (appui long)
- Ciel, photo sélectionnée
- Ciel, cadre sélectionné
- Ciel, déplacer le cadre
- Ciel, ordre d'affichage
- Ciel, premier démarrage

### Galerie

- Galerie
- Galerie, données de l'ordinateur
- Galerie, ajouter une photo
- Importer des photos
- Importer, méthode de placement
- Photo
- Photo, zoomée
- Photo, informations
- Photo, modifier les infos
- Placer la photo
- Identifier les étoiles
- Identifier les étoiles, choisir une étoile
- Identifier les étoiles, choisir sur la carte
- Identifier un astéroïde
- Astéroïdes trouvés
- Identifier des supernovae
- Identifier des comètes
- Galerie, aucune photo
- Galerie, résolutions en cours
- Importer, résolution échouée
- Importer, hors connexion

### Cibles

- Cibles
- Cibles, types d'objets
- Cibles, filtres
- Dessiner une région
- Cibles, régions du ciel
- Cibles, aucun setup
- Cibles, aucun résultat

### Plans

- Plans
- Détail du plan
- Plan, actions
- Plan, détail d'une cible
- Plan, fenêtre d'observation
- Plans, aucun plan

### Réglages

- Réglages
- Réglages (Settings)
- Réglages, setups (GearSetups)
- Équipement, modifier le setup (GearSetupEdit)
- Équipement, choisir un télescope (GearPicker)
- Réglages, lieu d'observation (Location)
- Lieu, horizon indisponible (HorizonUnavailable)
- Lieu, position refusée (LocationDenied)
- Réglages, exporter et importer (Backup)
- Cibles (Targets)
- Cibles, types d'objets (TargetsTypes)
- Cibles, filtres (TargetsFilter)
- Cibles, régions du ciel (Regions)
- Cibles, aucun setup (TargetsNoSetup)
- Cibles, aucun résultat (TargetsNoMatch)
- Plans (Plans)
- Détail du plan (PlanDetail)
- Plan, actions (PlanActions)
- Plan, détail d'une cible (PlanEntry)
- Plan, fenêtre d'observation (ObsWindow)
- Plans, aucun plan (PlansEmpty)
- Plan, confirmer la suppression (ConfirmDelete)
- Réglages, connexion à l'ordinateur
- Réglages, ordinateur connecté
- Réglages, setups
- Équipement, modifier le setup
- Équipement, choisir un télescope
- Réglages, lieu d'observation
- Lieu, horizon indisponible
- Lieu, position refusée
- Réglages, exporter et importer

### Feuilles et dialogues partagés

- Plan, confirmer la suppression
- Identification, explication ouverte
- Photo, choisir une identification
