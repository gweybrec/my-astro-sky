# CLAUDE.md — `packages/render/`

Auto-loaded under `packages/render/`. Canvas drawing of the sky map and its input handling.

- May use the DOM canvas and browser APIs. No Vue, no Pinia, no store, no i18n file of its own: texts come from `@myastrosky/core/i18n/index`.
- Imports only `@myastrosky/core/*` and its own files (lint error otherwise). Never `src/`, `server/`, `apps/`, `@capacitor/*` or `@myastrosky/app-state`.
- Type-check: `npm run typecheck:render`.
