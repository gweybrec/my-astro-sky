# WP3.8 — Make adding, exporting and restoring a photo fast on the phone

Model: sonnet · Depends on: WP3.7 · Needs device: yes (the orchestrator runs the device steps) · Needs browser: no

## Facts (Galaxy A16, `docs/dev/mobile/spike-results.md`, section "Phone backend (2026-10-06)")

| Step, for a 9.4 MB JPEG of 5760 x 3239 | Measured  |
| -------------------------------------- | --------- |
| `photos.upload`                        | 7.5 s     |
| of which the picture codec             | ~4.4 s    |
| of which writing the files             | 1.2-1.9 s |
| backup export of that one photo        | 4.3 s     |
| backup restore of that one photo       | 7.8 s     |

The earlier image test on the same phone decoded the same file and resized it to 2048 px in 0.3 to 0.6 s (`createImageBitmap` with `resizeWidth`). A 400 px thumbnail should not cost 4 s: something in `packages/backend-local/src/browser-image-codec.ts`, or in how the photo service calls the codec, does far more work than needed.

## Goal

On the same phone and the same two pictures: `photos.upload` **under 2 s** for the 9.4 MB picture, export and restore of one photo **under 3 s** each, with every suite still passing (adapters, backend contract 24/24).

## Steps

1. **Measure before changing.** In the test page (`spikes/mobile/src/…`, untracked), time each call the upload makes, by wrapping the codec and the blob store given to `createPhoneBackend` (through its overrides): `probe`, `bakeOrientation`, `thumbnail` (and inside the codec, with temporary marks: creating the `Blob`, `createImageBitmap`, drawing, `convertToBlob`), each `put` (and the base64 encoding against the plugin call), each database call. The orchestrator runs it on the phone and gives you the table. Put the table in the report.
2. **Fix what the table shows.** Likely causes to check, in this order; keep only what the measurements justify:
   - a full-size decode somewhere (a `createImageBitmap` without `resizeWidth`/`resizeHeight`, a second decode for the size, a canvas at full size, `resizeQuality: 'high'` on a large reduction: `'medium'` or `'low'` is enough for a 400 px thumbnail);
   - the picture decoded more than once per upload (probe, orientation and thumbnail each starting from the bytes): the header parser must be the only reader for `probe`, and `bakeOrientation` must return at once when there is no orientation;
   - copies of the whole file (`new Uint8Array(bytes)`, `slice` where `subarray` would do, a `Blob` built several times);
   - file writing: the base64 encoding of each piece (use a fast encoder: `btoa` over `String.fromCharCode.apply` on sub-pieces of 32 KB, never a character-by-character loop, never `reduce`), and the size of a piece (measure 1 MB, 4 MB and 8 MB; keep the fastest that does not raise the memory peak by more than the piece size);
   - backup export: pictures are already compressed, so they go into the ZIP **stored, not compressed** (fflate level 0) while the JSON files stay compressed; the archive stays a standard ZIP that the desktop reads (the cross-read test of `tests/unit/bundle-fflate.test.ts` must still pass, in both directions);
   - backup restore: if the restore decodes the picture again although the archive holds its thumbnail, say what the desktop does (`packages/core/src/services/backup.ts`) and do **not** change that behaviour; make the codec fast instead.
3. **Keep the adapters' behaviour**: the conformance suites and the backend contract pass unchanged, in Node and on the phone. Where a fix is in core (the photo service calling the codec twice, for instance), the database round-trip counts asserted by the service tests do not grow.
4. **Docs**: add to the section "Phone backend (2026-10-06)" of `docs/dev/mobile/spike-results.md` a subsection "After optimisation" with the step-by-step table before and after, and the piece size chosen.

## Must NOT

- Store a reduced copy in place of the original (the user decided: the phone keeps the original and a thumbnail).
- Change the archive's entry names or its manifest.
- Stage anything under `spikes/`.

## Escalate if

- The time is in the plugin's file writing itself and no piece size brings the 9.4 MB write under 1 s: report the figures and propose the smallest alternative (another way to write a file from the WebView), do not add a plugin yourself.
- `createImageBitmap` with a reduced size is itself slow on this WebView (give the isolated figure).

## Commit

`perf: add, export and restore a photo faster on the phone` (one commit; a second one for the documentation after the device confirms the figures is allowed: `internal(mobile): record the phone timings after optimisation`).

## Report, in addition to the common items

The step-by-step table before and after · each change and the time it saved · what was tried and dropped · the final figures for both pictures.
