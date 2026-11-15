# CLAUDE.md — `packages/render/`

Auto-loaded under `packages/render/`. Canvas drawing of the sky map and its input handling.

- May use the DOM canvas and browser APIs. No Vue, no Pinia, no store, no i18n file of its own: texts come from `@myastrosky/core/i18n/index`.
- Imports only `@myastrosky/core/*`, `jspdf` (the plan's PDF) and its own files (lint error otherwise). Never `src/`, `server/`, `apps/`, `@capacitor/*` or `@myastrosky/app-state`.
- Type-check: `npm run typecheck:render`.
- **Performance:** any change to a draw pass or to what the map computes each frame must state its per-frame cost (work × photos/objects/frames, off-screen ones included) and be measured (`profile-performance` skill) before it is presented. Avoid stacked `ctx.clip()` calls and per-frame work over every photo: lag that `npm run dev` hides shows in the Electron build and on the phone.
