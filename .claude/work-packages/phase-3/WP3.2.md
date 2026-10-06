# WP3.2 — Every error carries its code, and the app has a message for every code

Model: sonnet · Depends on: WP3.1 · Needs device: no · Needs browser: no

## Goal

On the phone the screens receive the services' errors directly, so the only reliable way to show a message in the user's language is the error's `code`. Today many errors reach the desktop screens without their code, the app has a message for 25 codes only, and some messages are translated by the server. Make the code travel everywhere and give the app a message for every code, in the four languages.

## Facts

- `server/routes/http-errors.ts` `sendError` sends `err.body ?? { error: err.message }`: the `code` is lost unless the error has a `body`.
- The app's messages are the `serverErrors.<CODE>` keys in `packages/core/src/i18n/{fr,en,es,de}.ts`. `parseServerError(data, fallbackKey)` in `src/api.ts` returns `t('serverErrors.' + code)` when the key exists, else `data.error`, else `t(fallbackKey)`.
- Codes thrown by the services with no message today (non-exhaustive, found by a search): `ASTROMETRY_LOGIN_FAILED`, `CATEGORY_NOT_FOUND`, `DUPLICATE_ENTRY`, `GEAR_NOT_CUSTOM`, `GEAR_NOT_FOUND`, `HORIZON_COMPUTE_FAILED`, `INVALID_DSO_DATA`, `INVALID_DSO_DEC`, `INVALID_DSO_ID`, `INVALID_DSO_RA`, `INVALID_ENTRY_PATH`, `INVALID_GEAR_DATA`, `INVALID_GEAR_TYPE`, `INVALID_JOB_ID`, `INVALID_LAT_LON`, `INVALID_MANIFEST_FORMAT`, `INVALID_PARAMS`, `INVALID_PHOTO_ORDER`, `INVALID_REGION_POINTS`, `MISSING_CAMERA`, `MISSING_NAME`, `MISSING_TELESCOPE`, `NO_RECOGNISED_CONTENT`, `REGION_NOT_FOUND`, `SETTING_LOCKED_BY_ENV`, `SETUP_ENABLED_NOT_BOOLEAN`, `SETUP_FIELDS_REQUIRED`, `SETUP_NOT_FOUND`, `TNS_RATE_LIMITED`, `UNSUPPORTED_RAW_FORMAT`. Codes are also created through helpers (`invalidUpload(msg, 'CODE')`, `invalidParams`, `invalidOrder`, `invalidManifest`…), which a search for `code:` misses.

## Steps

1. **The complete list of codes.** Build it from the code, not from the list above: every `new DomainError(`, every helper that builds one, every result object with a `code` field (`SolveWcsResult`, the online-solving results, upload warnings), every code set in `server/routes/` (`RATE_LIMIT`, `UPLOAD_RATE_LIMIT`, `MISSING_FILE`, `RATE_LIMITED`, `INVALID_FILE_TYPE`…), and the codes WP3.1 added. Put the list in `packages/core/src/domain/error-codes.ts` as `export const ERROR_CODES = [...] as const` with `export type ErrorCode`. Where two codes mean the same thing (`RATE_LIMIT` and `RATE_LIMITED`), keep both and say so in the report; do not rename a code.
2. **The code on the wire.** `sendError` adds `code: err.code` to the body it sends for a `DomainError`, whether the body is the default or the error's own `body` (the body's own `code`, when it has one, wins). The pinning tests compare bodies: where an assertion is an exact comparison of an error body, add the `code` to the expected value and list each edited assertion in the report (this is the one change to pinning tests this card allows).
3. **A message for every code**, in `fr.ts`, `en.ts`, `es.ts` and `de.ts`, under `serverErrors`. Rules for the texts:
   - a code that already has a message keeps it, unchanged;
   - a code whose text the server translates today (`server/messages.ts`, `msg.api.*`; WP3.1's report lists them) takes that text, in the four languages, word for word, including its placeholders;
   - any other code: one short sentence saying what is wrong, in the user's words (for example `SETUP_NOT_FOUND`: "Ce setup n'existe plus."), with no technical term. The word "setup" stays "setup" in French.
4. **A test that keeps the two in step**: `tests/unit/error-codes.test.ts` checks that every entry of `ERROR_CODES` has a `serverErrors` message in each of the four languages, and that every `serverErrors` key is in `ERROR_CODES` (a key that nothing can produce any more, such as `ASTAP_NOT_INSTALLED` if you confirm it is dead, is removed from the four files and reported).
5. **A check that no code escapes the list**: in the same test, scan `packages/core/src` and `server` for the code literals of step 1's constructs (a simple regular expression over the source files is enough) and fail when one is not in `ERROR_CODES`. If this cannot be made reliable, replace it by typing: `DomainError`'s `code` becomes `ErrorCode`, so the compiler does the check. Prefer the typing if it costs fewer than 40 edited lines outside the list itself.
6. **`src/api.ts` uses the code everywhere.** Every function that throws `d.error ?? '<hard-coded text>'` or a fixed `t('errors.…')` on a failed response now goes through `parseServerError(data, fallbackKey)`, with today's text as the fallback (move a hard-coded English fallback to an `errors.*` key in the four languages). The special cases keep their behaviour: functions that return `[]`, `null` or `{ success: false, … }`, and the two polls that turn a 429 into "still running".

## What the user will see

Error messages that were in English or French whatever the language (for example when renaming a plan fails) now appear in the app's language. Nothing else changes. List in the report five examples of "before / after" texts in French.

## Must NOT

- Remove `server/messages.ts` or the `lang` field: other clients may rely on them.
- Change the status of any response, or any success response.

## Commit

`improvement: show every server error in the app's language`

## Report, in addition to the common items

The number of codes · the codes added to the four language files · the pinned assertions edited · keys removed as dead · the five before/after examples.
