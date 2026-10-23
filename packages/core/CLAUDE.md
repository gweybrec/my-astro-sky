# CLAUDE.md — `packages/core/`

Auto-loaded when you touch a file under `packages/core/`. Cross-cutting rules stay in the root
`CLAUDE.md`.

`@myastrosky/core` is the platform-neutral workspace package: it must run unchanged in the
browser, a worker, Node/Electron and Capacitor. Consumers import `@myastrosky/core/<module>`
(raw `.ts` via the `exports` map, no build step). Import core modules as `@myastrosky/core/<name>`
everywhere (`src/`, `server/`, `tests/`); no one-line re-export files remain (ESLint forbids new ones).

- **No DOM, Node or Vite globals.** `tsconfig.json` sets `lib: ["ES2022"]` and `types: []`; the only
  ambient globals are those declared in `src/env.d.ts` (`console`, `TextEncoder`, `TextDecoder`,
  `setTimeout`, `clearTimeout`, `URLSearchParams`). Do not add the `DOM` or `WebWorker` libs.
- **No imports** of `vue`, `pinia`, `@capacitor/*`, Node built-ins, or anything under `src/` or
  `server/` — enforced at `error` by `no-restricted-imports` in `eslint.config.js`.
- **Tests stay in `tests/unit/`** and import core modules as `@myastrosky/core/<name>` (also in `vi.mock`).
- Type-check with `npm run typecheck:core`.
- **Schema changes:** new migrations (version 15 and above) are SQL statements added to `MIGRATIONS` in `src/db/schema.ts`.
  Update `BASELINE_SCHEMA` and `SCHEMA_VERSION` in the same commit; `tests/unit/schema-baseline.test.ts` fails otherwise.
