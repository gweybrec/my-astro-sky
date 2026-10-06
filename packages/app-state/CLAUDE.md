# CLAUDE.md — `packages/app-state/`

Auto-loaded under `packages/app-state/`. Shared by the desktop and the phone; may use Vue and Pinia.

- **Goes in:** the data functions (`api.ts`), the backend holder (`backend.ts`), and stores that hold backend data or user data.
- **Stays out:** anything that builds or reads the page, `document`, `window` events, a store that only describes the desktop's panels.
- Imports only `@myastrosky/core/*`, `vue`, `pinia` and relative paths (lint error otherwise). Never `src/`, `server/`, `@capacitor/*` or a backend package.
- Errors go through `reportError` from `@myastrosky/core/platform/error-hook`; the backend is installed by the platform (`src/platform-init.ts`), never here.
- `src/api.ts`, `src/backend.ts` and `src/stores/<name>.ts` are one-line re-exports: do not rename an export.
- Type-check: `npm run typecheck:app-state`.
