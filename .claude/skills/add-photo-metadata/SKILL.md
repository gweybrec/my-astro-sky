---
name: add-photo-metadata
description: >
  Step-by-step guide for adding a new optional field to photo metadata.
  Covers all three UI editor contexts, DB migration, export/import,
  WCS pre-fill, and astrometry.net pre-fill.
  Trigger phrases: "add photo metadata field", "new metadata field",
  "add field to photo", "photo metadata", "metadata field".
---

# Adding a New Photo Metadata Field

This guide walks through every file that must change when adding an optional
field to photo metadata. Follow every section — missing any one context will
leave the field absent or broken in part of the UI.

---

## Unit Test Plan (mandatory, part of the plan)

Before writing any code, the plan must explicitly address unit tests:

- **List every test file to create or update**, with a brief description of what each test covers.
- The following changes always require tests: DB helper changes in `server/db.ts` (new columns, sanitization logic), new parse/transform logic in `server/wcs-reader.ts`, new extraction logic in `server/astrometry.ts`.
- UI-only changes (adding an `<input>` element and wiring it to an existing save call) do not require new tests if the underlying DB/API logic is already covered.
- If no unit test changes are needed, the plan must **state the justification** (e.g. "field is a plain string passthrough; DB/API layer has no new logic, existing tests cover the path").
- Identifying tests is part of the plan, not an afterthought. A plan that omits this section is incomplete.

Tests live in `tests/unit/`. Run with `npm test`.

---

## Overview of the 3 UI editor contexts

The same field must appear in all three:

| Context                   | File                     | Pattern                                                   |
| ------------------------- | ------------------------ | --------------------------------------------------------- |
| Single-photo upload modal | `src/photo-overlay.ts`   | closure-scoped `let pending<Field>` + direct `input` ref  |
| Batch upload cards        | `src/ui.ts`              | `BatchItem` interface + `(card as any)._<field>Input` ref |
| Gallery left-panel editor | `src/metadata-editor.ts` | `let edit<Field>` state + direct `input` ref              |

**Do not skip any context.** They are easy to forget because they are three
separate files with no shared abstraction.

---

## Step 1 — `src/types.ts`

Add the field to the `Photo` interface and to `PlateSolveResult`:

```typescript
// In Photo interface
myField?: string | null;   // adjust type as needed

// In PlateSolveResult interface (only if the value can come from a solver)
myField?: string;
```

`AstrometrySolveStatus` lives in this file too — add to it only if the
astrometry.net polling route will return the value (see Step 8).

---

## Step 2 — `server/db.ts`

### Migration (add column to existing databases)

```typescript
try {
  db.exec('ALTER TABLE photos ADD COLUMN my_field TEXT');
} catch {
  /* column exists */
}
```

Add this block after the existing migration block (around line 87).

### `insertPhoto` prepared statement

Add `my_field` to the column list and a `?` placeholder. Also update
`insertPhotoWithId` the same way.

### `createPhoto()` and `createPhotoWithId()`

Add `myField?: string | null` parameter; pass the sanitized value to `run()`.

Sanitize strings at the boundary — `null` or a trimmed string within a
reasonable max length. Never trust the client to send valid values.

### `getAllPhotos()`

Add `myField: p.my_field ?? null` to the mapped object.

### `updatePhotoMetadataStmt` and `updatePhotoMetadataWithNameStmt`

Add `my_field = ?` to the SET clause of both.

### `updatePhotoMetadata()`

Add `myField?: string | null` to the param object and pass the sanitized value
in both `.run()` calls (same order as the SET clause).

---

## Step 3 — `server/index.ts`

### Upload route `POST /api/photos`

Extract from `req.body` and pass to `createPhoto()`:

```typescript
const myField = typeof req.body.myField === 'string' ? req.body.myField.trim().slice(0, 100) : null;
```

### Metadata update `PATCH /api/photos/:id/metadata`

Same extraction + sanitization; pass to `updatePhotoMetadata()`.

### Import route (search for `createPhotoWithId`)

Pass the value from the manifest:

```typescript
typeof p.myField === 'string' ? p.myField : null;
```

### Swagger annotations

Update the `@swagger` blocks for the upload route, the PATCH route, and any
solver route that returns the new field. Run `npm run swagger:generate` after.

---

## Step 4 — `src/api.ts`

Add `myField?: string | null` to the metadata parameter type of:

- `updatePhotoMetadata()`
- `uploadPhoto()` — also append to `FormData` when present:
  ```typescript
  if (metadata?.myField) formData.append('myField', metadata.myField);
  ```

---

## Step 5 — i18n

Add two keys just before the Notes keys in all four files
(`fr.ts`, `en.ts`, `de.ts`, `es.ts`):

```typescript
metadataMyField: 'Label text',
metadataMyFieldPlaceholder: 'Placeholder or tooltip text',
```

---

## Step 6 — `src/photo-overlay.ts` (single-photo modal)

### State variable

Declare near `pendingNotes` (around line 1170):

```typescript
let pendingMyField = '';
```

### UI field

Add the input element just before the Notes field (around line 2400).
Use `dialog-input` class. For `datetime-local` inputs, see the CSS pitfall below.

### `prefillWCSMeta` function

This helper (defined around line 2455) is called in the WCS success handler.
Add the new field there:

```typescript
if (result.myField && !pendingMyField) {
  pendingMyField = result.myField;
  myFieldInput.value = ...; // format as needed for the input type
}
```

`myFieldInput` is declared in the same function scope so it is directly
accessible — no ref storage is needed here.

### `prefillWCSMeta` call sites

The function is called in **two** places in `solveWCS()`'s success path:

1. The normal path (around line 2941): `prefillWCSMeta(result);`
2. The dimension-mismatch `continueBtn` click handler (around line 2915): same call.

**Both must call `prefillWCSMeta`.** Missing the dimension-mismatch path means
pre-fill silently fails when the WCS file dimensions don't match the photo.

### Upload calls

Pass `myField: pendingMyField || null` to both `uploadPhoto()` calls and to the
`initialMeta` object in `openManualPlacement()`.

---

## Step 7 — `src/ui.ts` (batch upload cards)

### `BatchItem` interface

Add `myField: string` (around line 3588).

### Initialiser

Add `myField: ''` to the initial value (around line 3628).

### `buildCard()` — UI field

Add the input element just before Notes.

### Storing the ref on the card element

The WCS success handler runs asynchronously after `buildCard()` returns.
**Direct closure access does not work** — the handler runs outside the card's
closure. Store the input ref on the card DOM element:

```typescript
(card as any)._myFieldInput = myFieldInput;
```

Do this alongside `_obsDateInput`, `_refreshIntegrationRows`, etc. (around
line 4769).

### WCS prefill in the `wcsInput` change handler

Read the stored ref and update it:

```typescript
if (result.myField && !item.myField) {
  item.myField = result.myField;
  const inp = (card as any)._myFieldInput as HTMLInputElement | undefined;
  if (inp) inp.value = ...; // format as needed
}
```

### `scheduleMetaSave`

Add `myField: item.myField || null` to both the local photo object update and
the `updatePhotoMetadata()` call.

### Upload call

Pass `myField: item.myField || null` to `uploadPhoto()`.

---

## Step 8 — `src/metadata-editor.ts` (gallery editor)

### State variable

Add near `editNotes`:

```typescript
let editMyField = photo.myField ?? '';
```

### UI field

Add the input element just before Notes. If the value needs conversion
(e.g. UTC ISO → `datetime-local`), apply it when setting `input.value`.

### Save handler

Pass `myField: editMyField || null` to `updatePhotoMetadata()`.

---

## WCS pre-fill pipeline

When the user uploads a `.wcs`, `.tiff`, or `.fit` WCS companion file:

1. `server/wcs-reader.ts` — `parseFITSHeader()` reads the raw header.
   Add the new keyword to `extractWCS()`:

   ```typescript
   const rawVal = parsed['MY-KEY'];
   if (typeof rawVal === 'string') wcs.myField = rawVal;
   ```

   Extend the `WCSData` interface with the new optional field.

2. `server/index.ts` — `POST /api/solve-wcs` spreads the field into the response:

   ```typescript
   ...(wcs.myField ? { myField: wcs.myField } : {}),
   ```

3. `src/types.ts` — `PlateSolveResult` already has the field (Step 1).

4. Each of the 3 UI contexts calls `prefillWCSMeta` / stores the value when
   the response includes the field (Steps 6, 7, 8).

---

## Astrometry.net pre-fill

Astrometry.net has **two** result paths, both returning `PlateSolveResult`:

| Path               | API call                              | Server route                                         |
| ------------------ | ------------------------------------- | ---------------------------------------------------- |
| New submission     | `submitPlateSolve` + `pollPlateSolve` | `POST /api/solve-plate` + `GET /api/solve-plate/:id` |
| Reuse existing job | `reuseAstrometrySubmission`           | `POST /api/astrometry/reuse`                         |

### Current state

Neither path currently extracts FITS headers from the astrometry.net WCS
response — so neither returns `dateObs`, `expTime`, or `stackCnt`.

The astrometry.net API does provide a downloadable WCS FITS file for a solved
job (via `server/astrometry.ts`). To add pre-fill support:

1. After `reuseSubmission()` succeeds in `server/astrometry.ts`, fetch and
   parse the WCS FITS file with `extractWCS()` to get the new field.
2. Return the field in the `PlateSolveResult` from `reuseSubmission()`.
3. In `server/index.ts` at `POST /api/astrometry/reuse`, spread the field into
   `res.json()` the same way `solve-wcs` does.
4. For the poll route (`GET /api/solve-plate/:id`), extend `AstrometrySolveStatus`
   in `src/types.ts` and populate it the same way.
5. In `photo-overlay.ts`, call `prefillWCSMeta(result)` after `reuseAstrometrySubmission`
   succeeds (around line 2988) and after `pollPlateSolve` returns `'solved'`
   (around lines 3044–3073). Neither call exists today.

### Why it was not done for `observationDate`

The astrometry.net FITS WCS file **does not contain `DATE-OBS`** — that header
comes from the original image, not from the solver's output. Astrometry.net
solves the geometry only and does not copy instrument headers into its WCS
file. There is nothing to extract.

If a future metadata field _is_ derivable from the astrometry.net WCS output
(e.g. pixel scale, orientation angle), follow the steps above.

---

## Export / Import

Export is automatic: `getAllPhotos()` includes every column, and the export
route writes the full `Photo` object to `manifest.json`.

Import requires an explicit change: in the import route in `server/index.ts`,
find the `createPhotoWithId()` call and pass the value from the manifest:

```typescript
typeof p.myField === 'string' ? p.myField : null;
```

---

## Known pitfalls — do not repeat these mistakes

### 1. Forgetting `photo-overlay.ts` entirely

The most common mistake. The single-photo upload modal (`photo-overlay.ts`) is
a completely separate file from the batch cards (`ui.ts`). It must be updated
independently. Grep for `pendingNotes` to find the correct state block and
field insertion point.

### 2. Adding the WCS pre-fill to `ui.ts` but not to `photo-overlay.ts`

Even after adding the field to both files, the WCS prefill block in
`photo-overlay.ts` (`prefillWCSMeta`) must be explicitly extended. It is not
automatic. Check that `prefillWCSMeta` calls `result.myNewField` and sets both
the `pending*` variable and the `input.value`.

### 3. Missing the dimension-mismatch path in `photo-overlay.ts`

`solveWCS()` has two success branches: the normal one and one shown when the
WCS file dimensions don't match the photo (user must click "Continue"). The
`prefillWCSMeta` call must appear in **both** branches. If only one is updated,
pre-fill silently fails for WCS files with mismatched dimensions.

### 4. `datetime-local` input invisible on dark backgrounds

Any `<input type="datetime-local">` must have the CSS property
`color-scheme: dark` to make the browser-native calendar icon and date picker
appear white. The `.dialog-input` class already sets this. Do **not** create a
new input class or inline style for datetime fields — just use `.dialog-input`.

If you observe a black calendar icon in a dark panel, it means either:

- The input is missing the `dialog-input` class, OR
- `color-scheme: dark` was removed from `.dialog-input` in `src/style.css`.

### 5. Async ref access in batch cards (`ui.ts`)

In `ui.ts`, the WCS change handler runs in a closure that has no direct access
to inputs created inside `buildCard()`. The handler fires asynchronously after
`buildCard()` returns. Always store input refs on the card element:

```typescript
(card as any)._myFieldInput = myFieldInput;
```

Then read them back in the handler:

```typescript
const inp = (card as any)._myFieldInput as HTMLInputElement | undefined;
if (inp) inp.value = formattedValue;
```

In `photo-overlay.ts` this is not needed — everything is in one big closure.

---

## Checklist

- [ ] `src/types.ts` — `Photo` and `PlateSolveResult` updated
- [ ] `server/db.ts` — migration, prepared statements, CRUD functions, `getAllPhotos()`
- [ ] `server/index.ts` — upload route, PATCH route, import route, Swagger annotations
- [ ] `src/api.ts` — `updatePhotoMetadata()` and `uploadPhoto()` param types
- [ ] i18n — all four language files
- [ ] `src/photo-overlay.ts` — state variable, UI field, `prefillWCSMeta`, upload calls (both paths)
- [ ] `src/ui.ts` — `BatchItem` interface + init, `buildCard()`, card ref, WCS handler, `scheduleMetaSave`, upload call
- [ ] `src/metadata-editor.ts` — state variable, UI field, save handler
- [ ] WCS extraction — `server/wcs-reader.ts` `WCSData` + `extractWCS()`, `server/index.ts` response spread
- [ ] Export automatic; Import needs explicit `createPhotoWithId()` argument
- [ ] `npm run swagger:generate` run
- [ ] `npm run build` — zero TypeScript errors
- [ ] `npm test` — no regressions
- [ ] Browser-tested in all 3 UI contexts
