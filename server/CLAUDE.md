# CLAUDE.md — `server/` (backend)

Auto-loaded when you touch a file under `server/`. Cross-cutting rules (commands, commit
conventions, the CI gate, architecture overview) stay in the root `CLAUDE.md`.

## Conventions

- Backend reads `PORT` env var (default 3001) and `DB_PATH` (default `./data.db`).
- Vite proxies `/api` and `/uploads` to `http://localhost:3001` during dev.
- Uploaded photos go to `uploads/` directory on disk, named with UUIDs.
- Filters are served at `GET /api/filters` and consumed via `src/gear-catalog.ts` (they are **not** part of a gear setup — picked per integration row / observation window). The catalog itself is `resources/filters.json`; see `scripts/CLAUDE.md` for the colour-seeding step.
- Migrations 1 to 14 in `server/db-migrations.ts` are frozen. New migrations (version 15 and above) are SQL statements added to `MIGRATIONS` in `packages/core/src/db/schema.ts`, and `BASELINE_SCHEMA` and `SCHEMA_VERSION` are updated in the same commit; `tests/unit/schema-baseline.test.ts` fails otherwise.
- New persistence code goes through the `SqlDb` port (`packages/core/src/ports/sql-db.ts`, adapter `server/sqlite-adapter.ts`). Inside `SqlDb.transaction` only `tx` calls may be awaited; awaiting anything else rolls the transaction back with `SQL_TX_AWAITED_NON_DB`. Inside a transaction body, use only `tx`; outer `SqlDb` calls are rejected with `SQL_TX_OUTER_CALL` (the port has three error codes: `SQL_TX_AWAITED_NON_DB`, `SQL_TX_NESTED`, `SQL_TX_OUTER_CALL`).

## Adding or changing a route

- **Where a route goes:** in the router file of its domain under `server/routes/` (map in `docs/dev/architecture.md`). A new domain gets a new file exporting `<name>Router`, plus one `app.use(<name>Router)` line in the mount block of `server/app.ts`. `server/index.ts` only starts the app.
- **`tests/unit/server-app.test.ts` lists every route** and must be updated when a route is added or removed.
- **Every route needs Swagger JSDoc annotations**, kept in a `@swagger` comment right next to the route. Regenerate the spec with `npm run swagger:generate` (writes `public/swagger.json`).
- **Log backend errors** through `server/logger.ts` — do not bare `console.error`.
- Full walkthrough for an API-route change (with the frontend side): the `fullstack-feature` skill.

## Tests

Editing a `.ts` file here? See [tests/CLAUDE.md](tests/CLAUDE.md) for the matching-test-file rule (a PostToolUse hook also runs `npx vitest run` after every `server/**/*.ts` edit).
