# CLAUDE.md — `packages/core/`

Auto-loaded when you touch a file under `packages/core/`. Cross-cutting rules stay in the root
`CLAUDE.md`.

`@myastrosky/core` is the platform-neutral workspace package: it must run unchanged in the
browser, a worker, Node/Electron and Capacitor. Consumers import `@myastrosky/core/<module>`
(raw `.ts` via the `exports` map, no build step); the old `src/` / `server/` paths are one-line
`export *` shims.

- **No DOM, Node or Vite globals.** `tsconfig.json` sets `lib: ["ES2022"]` and `types: []`; the only
  ambient globals are those declared in `src/env.d.ts` (`console`, `TextEncoder`, `TextDecoder`,
  `setTimeout`, `clearTimeout`). Do not add the `DOM` or `WebWorker` libs.
- **No imports** of `vue`, `pinia`, `@capacitor/*`, Node built-ins, or anything under `src/` or
  `server/` — enforced at `error` by `no-restricted-imports` in `eslint.config.js`.
- **Tests stay in `tests/unit/`** and import through the shims (`src/…` / `server/…`).
- `export *` does not re-export `default`: a shim for a module with `export default` also needs
  `export { default } from '@myastrosky/core/<module>';`.
- Type-check with `npm run typecheck:core`.
