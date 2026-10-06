# WP2.3d and WP2.3e — The settings service and the gear service

Model: sonnet for both · One sub-card at a time, in order · Depends on: WP2.4a · Needs device: no · Needs browser: no

Each sub-card is run by its own worker and makes **one commit**. The worker's prompt is this whole file plus the line "Run sub-card WP2.3x only".

## Read first

`.claude/work-packages/phase-2/WP2.3-first-services.md`: its sections "Goal", "The pattern", "Must NOT", "Acceptance" and "Escalate if" apply here word for word, with these additions:

- **Two tests pin the behaviour and must pass unedited:** `tests/unit/server-app.test.ts` and `tests/unit/server-backup.test.ts` (export, import and their round trip).
- Model to copy: `packages/core/src/services/poi-categories.ts`, `server/routes/poi-categories.ts`, `server/services.ts`, `server/routes/http-errors.ts`.
- A handler that logs with `console.error` today keeps that log for errors that are not `DomainError`.

## Step 0 (both)

Check `git branch --show-current` is `mobile/phase-2`, that `git status --short` shows no modified tracked files, and that `npx vitest run tests/unit/server-app.test.ts tests/unit/server-backup.test.ts` passes before you change anything. If not, stop.

---

## WP2.3d — Settings

### What exists (verified 2026-10-04; re-check line numbers)

- `server/routes/settings.ts` has eight routes. Five are server-only and **stay exactly as they are**: `GET /api/version/latest`, `GET /api/config`, and the three `POST /api/settings/probe-*`. Three are settings proper: `GET /api/settings`, `PUT /api/settings`, `DELETE /api/settings/astrometry-api-key`.
- `server/db.ts` holds `getSetting`, `setSetting`, `deleteSetting` (near lines 627-661) and the secret handling (near 581-625): `SECRET_SETTINGS` (only `ASTROMETRY_API_KEY`), the prefix `enc:v1:aesgcm:`, AES-256-GCM with the raw 32-byte key read from `process.env.SETTINGS_ENCRYPTION_KEY`. Rules of `getSetting`:
  - secret key: if `process.env[key]` is set, return it without reading the database; a stored value with the prefix that cannot be decrypted gives `undefined`; a stored plaintext value, when an encryption key is configured, is re-encrypted in place and returned; no row gives `process.env[key]`;
  - other keys: the database value if there is one, else `process.env[key]`.
  - `setSetting` encrypts a secret when a key is configured, else stores it as plain text.
- The solver modules `server/astap.ts`, `server/solve-field.ts` and `server/astrometry.ts` call the synchronous `getSetting`, and three tests mock the module `server/db` with only `getSetting`. **These stay on the old function in this card.** `tests/unit/settings-security.test.ts` and `tests/unit/sqlite-adapter.test.ts` also use the three old functions and must pass unedited.

### Steps

1. **Ports**, in `packages/core/src/ports/`:
   - `secret-codec.ts`: `export interface SecretCodec { canEncrypt(): boolean; encrypt(plain: string): Promise<string>; decrypt(stored: string): Promise<string | null>; isEncrypted(stored: string): boolean; }` with comments: `encrypt` returns the input unchanged when it cannot encrypt; `decrypt` returns the input for a value that is not encrypted, and `null` when it cannot be decrypted.
   - `env-source.ts`: `export type EnvSource = (key: string) => string | undefined;` (the server passes `process.env`; the phone passes a function that returns `undefined`).
2. **Move the crypto, do not copy it.** Create `server/secret-codec.ts` with the three helpers that `server/db.ts` has today (`getSettingsEncryptionKey`, `encryptSecret`, `decryptSecret`) and the prefix constant, exported, unchanged. `server/db.ts` imports them from there. Add `createServerSecretCodec(): SecretCodec`, a thin asynchronous wrapper over the same functions.
3. **`packages/core/src/services/settings.ts`**, `createSettingsService({ db, secrets, env })` with:
   - `get(key: string): Promise<string | undefined>`: the rules above, for secret and other keys, including the re-encryption of a plaintext secret;
   - `set(key: string, value: string): Promise<void>` and `remove(key: string): Promise<void>`;
   - `readPublic(): Promise<Omit<ServerSettings, 'isWindows'>>`: what `GET /api/settings` returns today except `isWindows` (the route adds it from `process.platform`). `ServerSettings` is in `packages/core/src/domain/settings.ts`. The secret's value is never returned, only `apiKeySet`;
   - `update(body: unknown): Promise<{ apiKeyChanged: boolean }>`: the logic of today's `PUT`, in the same order: the API key first (a non-blank string, trimmed; refused with a `conflict` `DomainError` carrying the exact 409 body of today when the environment defines the key), then the four string settings (written when the value is a string, trimmed, even when empty), then the two boolean settings (written as `'1'` or `'0'` only when the value is a boolean). The key lists move from the route into the service and are exported;
   - `removeApiKey(): Promise<void>`: today's `DELETE`, with the same 409.
     The set of secret keys is a constant of the service. All writes of one `update` call go in one `db.transaction` (inside it, only `tx`); do the encryption **before** opening the transaction, because a transaction body may only await `tx` calls.
4. **Route:** the three settings routes call the service. `resetAstrometrySession()` stays in the route, called as today (after a key write, and in the delete route).
5. **`server/services.ts`:** `export const settings = createSettingsService({ db, secrets: createServerSecretCodec(), env: (k) => process.env[k] })`.
6. **The old functions stay** in `server/db.ts` for the solver modules and the two tests named above. Above them, add this comment: "Kept for the solver modules until they move to services (astap, solve-field, astrometry). The rules are also in `packages/core/src/services/settings.ts`; `tests/unit/settings-service.test.ts` proves the two agree."
7. **Tests: `tests/unit/settings-service.test.ts`.**
   - On a private in-memory database with `initSchema` and a fake codec and env: every rule of `get` (secret and other keys, env first or database first, undecryptable value, plaintext secret re-encrypted in place), `set`, `remove`, `readPublic` (defaults on an empty database; the secret never present), `update` (each kind of field, each ignored case, the 409 body), `removeApiKey`.
   - With the real `server/db.js` (the `DB_PATH=':memory:'` dynamic-import pattern), the real codec and `SETTINGS_ENCRYPTION_KEY` stubbed: a value written by the service is read identically by the old `getSetting`, and a value written by the old `setSetting` is read identically by the service, for a secret and for a plain key, with and without an encryption key; the stored secret starts with the prefix when a key is configured.

### Escalate if (in addition)

- Keeping the old functions makes a test fail, or the two implementations cannot be made to agree.

Commit: `internal(refactor): move settings into a core service`.

---

## WP2.3e — Gear and setups

### What exists (verified 2026-10-04; re-check line numbers)

- `server/routes/gear.ts` (13 routes) loads the four built-in catalogues from `resources/*.json` with `fs.readFileSync` at import time, and merges each with the custom gear of that type, sorted by `byBrandModel` (`localeCompare` on "brand model").
- Custom gear: table `custom_gear(id, type, data)`; `data` is the user's object with its `id` inside; ids are `custom-<uuid>`. `POST /api/custom-gear` checks only the type (one of four) and that `data` is a non-array object. `DELETE /api/custom-gear/:id` refuses an id without the `custom-` prefix (400) and an unknown id (404). `DELETE /api/custom-gear` deletes only ids starting with `custom-`.
- Setups: table `gear_setups`; ids are `setup-<uuid>`; `POST` returns three different 400 bodies with codes (`MISSING_NAME`, `MISSING_TELESCOPE`, `MISSING_CAMERA`); `PUT` has one 400 body, creates the row when the id is unknown, and uses `INSERT OR REPLACE` (the row moves to the end of the `ORDER BY rowid` list); `PATCH enabled` returns 400 for a non-boolean and 404 for an unknown id; `DELETE` returns 404 for an unknown id.
- Nothing checks that a setup's gear ids exist, and nothing is cascaded to plans or photos when a setup or a gear item is deleted. Keep it so.
- `server/routes/backup.ts` uses six of the `server/db.ts` gear functions for export, for the import preview and for import (delete by name, then upsert; custom gear of type `filter` is exported but not imported). `tests/unit/import-export.test.ts` calls the same functions directly (near lines 945-995).

### Steps

1. **Types:** in `packages/core/src/domain/gear.ts`, add `CustomGearType` (`'telescope' | 'camera' | 'accessory' | 'filter'`) and `GearCatalog` (`{ telescopes: readonly object[]; cameras: readonly object[]; accessories: readonly object[]; filters: readonly object[] }`). `GearSetupData` is already there.
2. **`packages/core/src/services/gear.ts`**, `createGearService({ db, newId, catalog })`, where `catalog: GearCatalog` holds the built-in lists (the service never reads a file). Methods, each reproducing its route:
   - `listCatalog(type: CustomGearType): Promise<object[]>` (built-in plus custom of that type, sorted as today);
   - `addCustom(type: unknown, data: unknown): Promise<{ id: string }>`, `removeCustom(id: string): Promise<void>`, `removeAllCustom(): Promise<number>`;
   - `listSetups(): Promise<GearSetupData[]>`, `createSetup(input: unknown): Promise<{ id: string }>`, `replaceSetup(id: string, input: unknown): Promise<void>`, `setSetupEnabled(id: string, enabled: unknown): Promise<void>`, `removeSetup(id: string): Promise<void>`, `removeAllSetups(): Promise<number>`;
   - what the backup routes need, named for what they do (for example `exportCustom()`, `importCustom(...)`, `importSetup(...)`): read `server/routes/backup.ts` and keep its behaviour exactly, including what it does not import. Where it deletes by name and then writes, do both in one `db.transaction` if and only if the two tests still pass unedited; say in the report which you did.
3. **Catalogue loading** moves out of the route into `server/gear-catalog.ts` (`loadBuiltInGearCatalog(): GearCatalog`, the same four reads from `RESOURCES_DIR`), called once in `server/services.ts`.
4. **Route and backup** call the service. Callbacks passed to `forEach` become `for … of` loops with `await`.
5. **Delete from `server/db.ts`:** the ten gear and setup functions with their statements and row types (`getCustomGearByType` is unused: delete it too), following rule 6 of the pattern.
6. **Tests:** `tests/unit/gear-service.test.ts` (pattern rule 7), with a small fake catalogue; the cases of `tests/unit/import-export.test.ts` that call the deleted functions are rewritten to call the service, keeping their assertions.

### Do not touch

`src/gear-catalog.ts` and anything else under `src/` (the frontend has its own gear types; unifying them is a later card). `sanitizeSetupId` in `server/db.ts` (it belongs to photos).

Commit: `internal(refactor): move gear and setups into a core service`.

---

## Commits

- `CLAUDE.md` forbids committing without the user's explicit permission. **The user gave it on 2026-10-03: commits are allowed on the new branches only.** That means the `mobile/*` and `spike/*` branches. Never on `master` or `dev`. Never push.
- **One commit per sub-card**, made when its acceptance passes, with files staged by explicit path. Before committing, check `git branch --show-current` is `mobile/phase-2`.
- Message: the one given in the sub-card.
- **Never add a `Co-Authored-By` line or any AI attribution.**

## Always forbidden

- Do not start a dev server. Do not kill any process you did not start (port 3001 may be in use by the user's own app).
- Do not install SDK packages, emulators, AVDs or system images. Do not run sdkmanager or avdmanager.
- Do not push. Do not switch branch. Do not use `git add -A`, `git add .`, `git clean`, `git stash`, `git reset --hard` or `git checkout -- <file>` on a file you did not change yourself.
- Do not touch untracked files that you did not create.

## Report (each sub-card)

Files changed and created · the service's method list with signatures · functions deleted from `server/db.ts`, and any kept with the reason · existing tests rewritten (file, what changed) · acceptance output · "Seen, not fixed" · deviations · open questions.
