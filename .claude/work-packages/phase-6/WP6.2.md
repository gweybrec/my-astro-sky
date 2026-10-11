# WP6.2 and WP6.3 — The Cibles tab, then the Plans tab

Model: sonnet for both · Branch: `mobile/phase-3b` · One card at a time, one commit each · Depends on: WP6.1b · Needs device: no

Each worker reads `.claude/work-packages/phase-6/WP6-common.md`, `.claude/work-packages/phase-3/WP3-common.md`, then this file, and runs the card named in its instructions.

---

## WP6.2 — The Cibles tab

### Goal

Make the Cibles tab real, from its boards: "Cibles", "Cibles, types d'objets", "Cibles, filtres", "Cibles, régions du ciel", "Cibles, aucun setup", "Cibles, aucun résultat". "Dessiner une région" needs the sky map: its entry is built disabled.

### The logic is in the desktop's targets screen: extract it first

`src/targets-view.ts` (about 6,000 lines) mixes the recommendation's logic with page building. The phone needs the logic unchanged. Extract to `packages/core/src/targets/` (several small modules), with the desktop calling the extracted functions in place of its own code, its tests green (`tests/unit/targets-view-filter.test.ts`, `target-recommender-integration.test.ts`, `smart-sort.test.ts` and the others that touch it), and new unit tests for each extracted function:

- the preferences: their type, defaults, loading with the migration from the older key, saving (lines 109-188), through `@myastrosky/core/platform/storage`;
- `sortCustomFirst` (218-250), `filterTargetDSOs` (253-270), `snapToObservationTime` (318-337), `buildPageList` (349-361), `sortSuggestions` (362-404), the small formatters (277-300);
- from inside `class TargetsView`, as free functions taking what they read from `this` as parameters: `nightWindow` (3660-3698), `timeWindowFor` (3699-3714), `moonSeparationAt` (3715-3724), `moonEventsInWindow` (4656-4677), `getPlanObserverFor` (3556), `planPreset` (3601-3627), `resolvePlanSetup` (3628-3659);
- the orchestration of `runRecommendation` (2532-2718) without its page building: one function that takes the preferences, the setups, the gear, the photos (for "exclude photographed"), the horizon and the regions, validates, and returns either the list of rows' data with the page information or a typed reason for an empty result (no setup, invalid location, nothing matches);
- the altitude curve's computation of `buildAltChart` (5654-5867), separated from its drawing, if the board's rows or sheets show a curve.

Line numbers are from an earlier state of the file: find the functions by name. Extract only what the phone's boards need; list what you left.

### Steps

1. The extraction above (it may be large: keep each moved function identical, only its inputs change from `this.…` to parameters).
2. The list: rows as the board shows (name, type badge, the figures shown, the order control), the context fields above it (setup, location, date or "Ce soir", types), paging or continuous loading as the board shows, the states "aucun setup" (its button goes to the setups screen of Réglages) and "aucun résultat".
3. The types sheet and the filters sheet, with every control of the boards (the scroll bar always visible where the board shows it), applying at once. The regions list (choose, delete with confirmation; drawing one is disabled).
4. The actions of a row or of its sheet as the board shows them. "Ajouter au plan" works (plans store, including "new plan"). Actions that need the sky map are disabled as `WP6-common.md` says.
5. Performance: the recommendation runs over about 12,000 objects. Measure it in the phone-sized browser with the CPU slowed 4 times (through the browser's debugging protocol): the first list must appear in under 1 second and a change of filter must not block the page for more than 200 ms; if it does, run the computation in steps that yield, or in a worker, and report the figures before and after.
6. Checks of `WP6-common.md`.

### Commit

`feat(mobile): target recommendations on the phone`

---

## WP6.3 — The Plans tab

### Goal

Make the Plans tab real, from its boards: "Plans", "Détail du plan", "Plan, actions", "Plan, détail d'une cible", "Plan, fenêtre d'observation", "Plan, confirmer la suppression", "Plans, aucun plan".

### Steps

1. Extraction, as for WP6.2, of what the desktop computes for a plan inside `src/targets-view.ts` and that the boards show: `computePlanTargets` (3737-3779), the plan's time window and Moon figures, the altitude curve of `buildPlanChart` (5537-5653) separated from its drawing, the observation windows' rules (`packages/core/src/observation-windows.ts` is already shared; what `buildObservationWindowUi` (5193-5536) validates or computes goes with it), the order of a plan (`packages/core/src/plan-order.ts`, `plan-sort.ts`).
2. The list of plans (create, rename, reorder if the board shows it, delete with confirmation), the plan's detail (its night, setup and location, its targets in their order, the sort control, reordering by hand if the board shows it), the actions sheet, a target's detail (its figures, its position angle, its observation windows), the observation window editor (Annuler / Valider; UTC written explicitly where the board does).
3. Everything goes through the plans store of `@myastrosky/app-state/stores/plans` and the data functions. The phone pays about 19 ms per database call: an action of the user must not make calls in a loop (reordering sends one request; adding several targets uses one grouped call if the service has one, otherwise report it).
4. Export of a plan (PDF or other) only if a board shows it; mosaics and frames need the sky map: their controls are disabled as `WP6-common.md` says.
5. Checks of `WP6-common.md`.

### Commit

`feat(mobile): observing plans on the phone`
