# Working on Both Apps

MyAstroSky is two apps in one repository: the desktop app (a web page served by an Express server, also packaged with Electron) and the phone app (Capacitor + Ionic Vue, Android). This page explains how their code is divided, how the two user interfaces are kept apart, how the phone app adapts when the phone is turned, and how to develop and test a change without re-testing everything each time.

The details of each part are in other pages: [architecture.md](architecture.md) (the desktop's modules and data flows), [mobile-architecture.md](mobile-architecture.md) (the shared packages, the backend seam, the services and the phone's adapters), [ui-guidelines.md](ui-guidelines.md) (the desktop's look) and [ui/mobile.md](ui/mobile.md) (the rules of the phone's screens).

## One repository, three layers

```
            Desktop UI (src/)                     Phone UI (apps/mobile/)
            Vue + DOM modules, UnoCSS              Ionic Vue, design-system stylesheet
                     │                                        │
                     └──────────────┬─────────────────────────┘
                                    │  imports only through @myastrosky/*
      ┌─────────────────────────────┼──────────────────────────────────┐
      │ packages/app-state   data functions (api.ts), backend holder, stores of backend data
      │ packages/render      the sky map's canvas drawing, hit testing, input
      │ packages/core        astronomy, catalogues, recommender, services, ports, schema, i18n
      └─────────────────────────────┬──────────────────────────────────┘
                                    │  Backend interface
                 ┌──────────────────┴──────────────────┐
     packages/backend-http                    packages/backend-local
     → Express server (server/)               → services on the phone's own database and files
```

Each layer has one job:

| Layer                     | Holds                                                                                                                                       | Never holds                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `packages/core`           | Every rule of the domain and every computation: what a fact means, how a value is written, how a plan is scored, how a correction is built. | DOM, Node, Vue, Capacitor.                             |
| `packages/app-state`      | The functions screens call to read and change data, and the stores both apps keep in memory.                                                | Layout, styles, components.                            |
| `packages/render`         | The sky map: drawing, hit testing, mouse and touch input.                                                                                   | Panels, sheets, buttons around the map.                |
| `src/` and `apps/mobile/` | Screens: layout, components, styles, navigation, and the glue between a screen and the shared functions.                                    | Domain rules. A screen asks core, it does not compute. |

The dependency rules are enforced by ESLint and by each package's `tsconfig` ([mobile-architecture.md](mobile-architecture.md#dependency-rules)).

## How the two UIs are kept apart

The two apps share **logic, data, drawing, texts and icons**. They never share a screen or a component.

| Shared                              | How                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| Logic and formatting                | `@myastrosky/core/*`                                                                              |
| Data and the stores of backend data | `@myastrosky/app-state/*`                                                                         |
| The sky map                         | `@myastrosky/render/*`, configured per app with `SkyMapOptions` (touch, density, panel test)      |
| Texts                               | `packages/core/src/i18n/` (desktop keys), `packages/core/src/i18n/mobile/` (the phone's own keys) |
| Icons                               | The desktop's SVG files in `src/icons/`, imported by the phone through the `@icons` alias         |

Everything else is separate:

|            | Desktop (`src/`)                                                                            | Phone (`apps/mobile/`)                                                                                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Components | Vue components (`src/components/`) and DOM modules (`src/*.ts`)                             | Ionic's components wrapped in the shared `src/components/Phone*.vue`                                                                                                                                          |
| Styles     | `src/styles/tokens.css`, `src/style.css`, UnoCSS (`uno.config.ts`), themes (`src/theme.ts`) | The design system's stylesheet and tokens (`src/theme/design-system/`), Ionic's variables mapped in `src/theme/ionic-tokens.css`, the shared components' rules in `src/theme/phone-components.css`; dark only |
| Navigation | One page, panels and modals                                                                 | Ionic tabs, pushed pages, sheets                                                                                                                                                                              |
| Start-up   | `src/platform-init.ts`: HTTP backend, `localStorage`                                        | `apps/mobile/src/platform-init.ts`: local backend, device storage                                                                                                                                             |

Rules that keep it so:

- **The phone app never imports `src/` or `server/`.** ESLint fails on it. When a phone screen needs something the desktop does, that code first moves to a package, and the desktop then calls the package's version. The desktop's behaviour must stay the same; its tests prove it.
- **A desktop module never imports `apps/mobile/`.** The desktop's builds (Docker, Electron) do not even install the phone app's dependencies.
- **One function, two callers.** When logic exists in one app and the other needs it, there is one copy, in a package. A screen that re-implements a rule of core is a bug even when it gives the same result today.
- **A change to a shared module is a change to both apps.** Its tests live in `tests/unit/`, its callers in both apps are found with a search for its import path.

## Portrait and landscape on the phone

Turning the phone does not reload anything. The Android activity declares the orientation and screen-size changes it handles itself (`android:configChanges` in `apps/mobile/android/app/src/main/AndroidManifest.xml`), so the WebView keeps the same page, the same route, the same Vue state and the same open sheet. Only the size of the page changes, and the layout follows it.

### The layout follows the page's shape

A screen is written once. Its two layouts come from CSS: the rules under `@media (orientation: landscape)` in `src/theme/ionic-tokens.css` and `src/theme/phone-components.css`. No screen has a second component for landscape, and no screen reads `screen.orientation`.

| Part                                             | Portrait                                                               | Landscape                                                                                      |
| ------------------------------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Tab bar                                          | At the bottom                                                          | A rail on the left (`--rail-width`), buttons in a column                                       |
| A pushed page                                    | Full width                                                             | A centred column (`--mobile-column-max`); a form's footer buttons at the right, of fixed width |
| A sheet over a scrim (`PhoneSheet`)              | Full width at the bottom, the height of its content up to a cap        | A centred card of limited width                                                                |
| A sheet over the map (`PhoneMapSheet`)           | At the bottom, at most a third of the map (two thirds once dragged up) | A column at the left, as tall as the map under its search row                                  |
| A map mode (hand placement, star identification) | A panel under the map, foldable                                        | A settings column beside the map (`--mobile-side-panel`)                                       |
| Dialogs                                          | Full width minus the gutters                                           | Limited width                                                                                  |
| The gallery grid                                 | Its own number of photos per line                                      | Its own number of photos per line (each orientation keeps its setting)                         |

### The system bars

The system bars are given as safe-area insets, and they move when the phone turns: in landscape a display cut-out or a three-button navigation bar sits at the left or the right, depending on which way the phone was turned. `src/theme/ionic-tokens.css` turns them into `--safe-top`, `--safe-bottom`, `--safe-left` and `--safe-right` once; the tab frame and the pushed pages apply the left and right ones. A screen never reads `env(safe-area-inset-*)`, so it is right in both landscapes and with both kinds of navigation without doing anything.

### When code must know the orientation

A few behaviours are not layout, and read the orientation with `window.matchMedia('(orientation: landscape)')`, listening to its changes:

- the hand placement panel folds only in portrait (`pages/sky/SkyPlacement.vue`);
- a sheet held to a third grows to two thirds only in portrait (`composables/useSheetDrag.ts`);
- the gallery uses the photos-per-line setting of the current orientation (`pages/GalleryPage.vue`);
- the pages of a photo's object chips are cut again when the width changes (`pages/sky/SkyPhotoSheet.vue`).

The sky map redraws itself when its canvas box changes size (`followCanvasSize` in `SkyMapOptions`), which covers the turn.

Keep it that way: if a difference between the orientations is only layout, it is a CSS rule; only behaviour reads `matchMedia`.

### Mockups

Every screen has a portrait mockup and a landscape mockup (its title ends with ", paysage"). A new screen or a visible layout change is drawn in both before it is coded; see [ui/mobile.md](ui/mobile.md).

## Developing a change

### Where to start

| The change                                         | Start in                                                                                                                                                | Then                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| A rule, a computation, a formatted value           | `packages/core`, with its test                                                                                                                          | The screens that show it (both apps, if both do)       |
| Data kept by the backend (a new field, a new call) | The service in core, the `Backend` interface, both backends, the route, `app-state/api.ts` ([the steps](mobile-architecture.md#adding-a-data-function)) | The screens                                            |
| The sky map's drawing or input                     | `packages/render`                                                                                                                                       | Both apps' map pages                                   |
| A desktop screen                                   | `src/`                                                                                                                                                  | Nothing else, unless logic has to move to a package    |
| A phone screen                                     | Its mockups, then `apps/mobile/`                                                                                                                        | Logic the desktop already has moves to a package first |
| A feature both apps get                            | The logic in a package, used by the desktop first (its tests and look unchanged where they should be)                                                   | The phone screen, on the same functions                |

### Moving desktop code to a package

1. Move the logic, not the DOM: the package gets plain functions that take values and return values.
2. The desktop module calls them; its behaviour does not change. Its existing tests move with the logic to `tests/unit/`, importing the package (`@myastrosky/core/...`).
3. Only then does the phone screen call the same functions.

This keeps each step testable on its own, and the desktop's tests are what proves the move changed nothing.

## What to test for each kind of change

The tests are layered so that a change is tested where it is made, and the layers it cannot reach do not need a manual pass.

`npm run verify` runs before every commit, whatever the change: the type checks of every package and of both apps, ESLint, the phone's static checks, the formatting check, all unit tests of both apps, and both production builds. It is what guarantees that a change to a shared module still compiles and still passes in **both** apps, so the manual checks below are only about what a test cannot see.

| The change                                       | Automated proof (in `verify`)                                                                                       | Look at it in a browser                                                                                           | On the phone                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Pure logic in `core` (no visible change)         | Its unit test; both apps type-check                                                                                 | No                                                                                                                | No                                                                  |
| Logic in `core` that changes what a screen shows | Its unit test; the screens' tests that assert the text                                                              | The screens that show it, in each app that shows it                                                               | No                                                                  |
| A service or the `Backend` interface             | The service's test; the contract suite (`packages/core/src/testing/backend-contract.ts`), run against both backends | One screen that uses it, in one app                                                                               | Only for a slow path (round trips cost about 19 ms each on a phone) |
| A phone adapter (`packages/backend-local`)       | The port's conformance suite                                                                                        | No                                                                                                                | Yes: the plugins only exist on the device                           |
| A server route                                   | The route and contract tests                                                                                        | The desktop screen that calls it                                                                                  | No                                                                  |
| A store or a data function of `app-state`        | Its test; both apps type-check                                                                                      | One screen per app that uses it, if behaviour changed                                                             | No                                                                  |
| The sky map (`render`)                           | The tests of the modules that decide what to draw                                                                   | The map in both apps (the phone app in a phone-sized window)                                                      | Only if touch input changed                                         |
| A desktop screen                                 | The desktop's tests                                                                                                 | That screen at desktop size                                                                                       | No (the phone app cannot import it)                                 |
| A phone screen                                   | The phone app's tests (`apps/mobile/tests/`, Ionic stubbed, data functions mocked)                                  | That screen at 412 × 915 and 915 × 412, then `npm run check:alignment`                                            | Only for what a browser cannot show (below)                         |
| The phone's theme or design-system stylesheet    | The static checks                                                                                                   | `npm run check:alignment` (every listed view, three sizes), and a few representative screens in both orientations | No                                                                  |
| A text                                           | The error-code test requires every server error's message in the four languages                                     | The longest language (German) where the text is tight                                                             | No                                                                  |
| The database schema                              | `tests/unit/schema-baseline.test.ts`                                                                                | No                                                                                                                | Once, for the migration of an existing database                     |

A test that proves a fix fails on the old code: run it with the old version of the changed file in place, then put the new one back.

### What only the phone can show

A browser in a phone-sized window shows layout, texts and most interactions. Run the app on a real phone only when the change touches one of these:

- the system bars in both landscapes and with both kinds of navigation;
- the Android back button with a dialog, a sheet, a sub-page and a tab's first page;
- the keyboard covering a field;
- permissions (position), the file picker, the share sheet;
- touch gestures that a mouse does not reproduce (pinch, two-finger turn, a drag ending in a tap);
- the plugins: database, files, native HTTP;
- how long a slow path takes (importing, the first load of the catalogues).

Use a real phone, never an emulator. The scripts in `.claude/skills/mobile-device-test/scripts/` find the device, record and restore its settings, turn the screen, take screenshots and connect to the app's WebView for scripted checks. A phone with real data is only read: test data comes from an isolated database on the computer, brought in through the app's own import.

## The tools

| Tool                                        | What it does                                                                                                                                                                 |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/unit/`                               | Vitest tests of the packages, the server and the desktop                                                                                                                     |
| `apps/mobile/tests/`                        | Vitest tests of the phone screens, with Ionic's elements stubbed (`tests/helpers.ts`) and the data functions mocked                                                          |
| `packages/core/src/testing/`                | The backend contract suite and the conformance suites of the ports, shared by both implementations                                                                           |
| `apps/mobile/scripts/check-no-nudges.mjs`   | Rejects pixel offsets used to bring things into line, and raw sizes, in the phone's CSS (in `verify`)                                                                        |
| `apps/mobile/scripts/check-sheets.mjs`      | Rejects sheets drawn by hand instead of with the sheet components (in `verify`)                                                                                              |
| `npm run check:alignment`                   | Starts its own servers and browser, opens the phone's component gallery and real screens at three sizes, and measures baselines, centring, edges and gaps (0.5 px tolerance) |
| `npm run mobile:dev` + `npm run dev:server` | The phone app in a computer's browser (port 5174), on the desktop's server through a proxy; give the server its own `DB_PATH` and `UPLOADS_DIR`                              |
| `npm run mobile:android:build` / `:install` | The debug APK, and installing it on the connected phone                                                                                                                      |

Measure layout on a production build (`vite build`), not on the development server: the style sheets load in another order in development, and a rule that only ties with one of Ionic's wins there but loses in the app.
