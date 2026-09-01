# CLAUDE.md — `server/` (backend)

Auto-loaded when you touch a file under `server/`. Cross-cutting rules (commands, commit
conventions, the CI gate, architecture overview) stay in the root `CLAUDE.md`.

## Conventions

- Backend reads `PORT` env var (default 3001) and `DB_PATH` (default `./data.db`).
- Vite proxies `/api` and `/uploads` to `http://localhost:3001` during dev.
- Uploaded photos go to `uploads/` directory on disk, named with UUIDs.
- Filters are served at `GET /api/filters` and consumed via `src/gear-catalog.ts` (they are **not** part of a gear setup — picked per integration row / observation window). The catalog itself is `resources/filters.json`; see `scripts/CLAUDE.md` for the colour-seeding step.
- Schema changes go through `server/db-migrations.ts` (idempotent, run on startup).

## Adding or changing a route

- **Every route needs Swagger JSDoc annotations.** Regenerate the spec with `npm run swagger:generate` (writes `public/swagger.json`).
- **Log backend errors** through `server/logger.ts` — do not bare `console.error`.
- Full walkthrough for an API-route change (with the frontend side): the `fullstack-feature` skill.

## Tests

Editing a `.ts` file here? See [tests/CLAUDE.md](tests/CLAUDE.md) for the matching-test-file rule (a PostToolUse hook also runs `npx vitest run` after every `server/**/*.ts` edit).
