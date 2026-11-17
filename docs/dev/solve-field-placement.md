# solve-field Placement: Coordinate Conventions and EXIF Orientation

## How placement works

When solve-field solves a JPEG/PNG/TIFF/FITS, it writes a `.wcs` FITS file containing the WCS (World Coordinate System) solution. `wcsToCorrespondences` (core, re-exported by `server/wcs-reader.ts`) then turns this solution into **reference points**: 9 pairs of `(photoX, photoY)` ↔ `(RA, Dec)` at the corners, the edge middles and the centre of the photo, which tell the frontend affine transform where to place the image on the sky map.

Two independent coordinate-system issues must be handled correctly:

1. **Y-axis convention** in the WCS solution
2. **EXIF orientation** of the source JPEG

---

## 1. Y-axis convention: `fitsYConvention`

`wcsToCorrespondences(wcs, w, h, fitsYConvention)` converts display pixels to the solution's FITS pixels, then to sky coordinates. The `fitsYConvention` flag controls how FITS pixel coordinates map to display (screen) coordinates:

| Convention              | Y=1 at…             | Who uses it                                                                             |
| ----------------------- | ------------------- | --------------------------------------------------------------------------------------- |
| `fitsYConvention=true`  | **bottom** of image | PixInsight/Siril FITS files; **ASTAP** (`server/astap.ts`); any solver given a raw FITS |
| `fitsYConvention=false` | **top** of image    | solve-field, astrometry.net (JPEG/PNG/TIFF input)                                       |

**ASTAP** uses the **same pixel convention as the Siril/PixInsight metadata path**. This was verified empirically: solving `M97+M108.jpg` with ASTAP and reading the embedded WCS of the same image in `M97+M108.tiff` (Siril) gave the **same `CDELT2` sign and scale**. Since the metadata path passes `true` (`extractWCS` → `wcsToCorrespondences(..., true)` in `POST /api/solve-wcs`, `server/routes/solved-import.ts`) and places correctly, `server/astap.ts` passes `true` as well.

**solve-field writes its `.wcs` with Y=1 at the top row** when the input is a JPEG, PNG or TIFF (the natural storage order of those formats), so `server/solve-field.ts` passes `false` for them. For a FITS input it passes `true`, chosen from the file extension:

```typescript
// JPEG/PNG/TIFF: pixel (1,1) = upper-left, Y increases downward → false
// FITS: rows count from the bottom → true
wcsToCorrespondences(wcs, width, height, ext === '.fits' || ext === '.fit');
```

### Which file each solver receives

A TIFF, FITS or XISF import is converted to a PNG for display; the original file is kept as `rawFile` (desktop batch item) or as the pending photo's solve file (phone) and `solveInputFile` (`packages/core/src/photo-formats.ts`) picks what each engine is sent:

| Original | astrometry.net | ASTAP         | solve-field   |
| -------- | -------------- | ------------- | ------------- |
| FITS     | the FITS file  | the FITS file | the FITS file |
| TIFF     | the PNG        | the PNG       | the TIFF file |
| XISF     | the PNG        | the PNG       | the PNG       |

solve-field reads a TIFF through netpbm's `tifftopnm`, which takes 8 or 16 bits per sample and refuses 32 (the float TIFF stacking programs export). `server/solve-field.ts` (`tiffToSolveFieldFits`) therefore hands a 32-bit TIFF over as a 32-bit float FITS, decoded with `decodeTiffToFloat` (never sharp, which collapses float samples): colour channels averaged into one, rows written in the TIFF's top-to-bottom order, so the solution keeps `fitsYConvention=false`. 8- and 16-bit TIFFs go as they are.

astrometry.net and ASTAP read FITS only. A solution computed on a raw FITS is in the FITS file's own pixels (row 1 at the bottom, as `fits-decoder.ts` draws it), so every path that solves a FITS passes `fitsYConvention=true`: ASTAP always, solve-field by extension, and astrometry.net (`nova-solve.ts`) by the submitted file's name. astrometry.net's calibration fallback, which has no flag, mirrors `photoY` for a FITS instead. Reusing an astrometry.net job for another picture goes by the name of the file that job solved (`original_filename` of its details), not by the picture's own type: the desktop reuses with the PNG converted from a FITS, which shows the same way up as the FITS, so a job solved on a FITS still needs `fitsYConvention=true`.

The size of a FITS file comes from its header (`fitsImageSize`: `NAXIS1`, `NAXIS2`), never from an image codec and not from its WCS, so a FITS with no plate solution still has a size. The local routes accept `.fit`/`.fits` for ASTAP and solve-field, and `.tif`/`.tiff` for solve-field only. A FITS has no EXIF orientation.

**Raw FITS import ignores `ROWORDER`.** A WCS counts rows in stored order whatever `ROWORDER` says, and Siril shows and exports even a `ROWORDER = 'TOP-DOWN'` file with its first stored row at the bottom. `fits-decoder.ts` therefore always draws the first stored row at the bottom, which is what `fitsYConvention=true` assumes. Honouring `TOP-DOWN` there drew the picture upside down against its own objects.

---

## 1b. ASTAP false matches: the conformality guard

ASTAP cannot reliably determine the image **scale** on its own. When the scale is unknown, a _thorough_ search (`-speed slow -s 800`) combined with a **relaxed quad tolerance** (`-t 0.020`) makes ASTAP lock onto a **scale-distorted false match**: the solution has roughly the right field centre but a **sheared CD matrix** (`CROTA1 ≠ CROTA2` by tens of degrees). The affine fit then places the photo as a skewed **parallelogram** — a systematic, reproducible error that looks like an app bug but comes straight out of ASTAP.

Two defences in `server/astap.ts`:

1. **Do not relax the tolerance.** `-t 0.020` was the trigger; the default tolerance solves the same images cleanly and conformally. We keep `-speed slow -s 800` (they are safe and help sparse fields) but never pass `-t`.
2. **Conformality guard.** A genuine TAN-projection solve is conformal — the two CD-matrix columns are perpendicular and equal length. `cdMatrixSkewDeg(wcs)` measures the deviation from perpendicular; solutions above `MAX_CD_SKEW_DEG` (5°) are rejected with `msg.astap.distortedSolution`. Real solves measure < 1°; the observed false matches measured 40–130°.

> Debugging tip: run ASTAP directly (`astap_cli -f img.jpg -wcs -ra <h> -spd <90+dec> -r 10`) and read the `.wcs`. If `CROTA1` and `CROTA2` differ by more than ~1°, or the per-axis `CDELT1`/`CDELT2` scales are very unequal, it's a false match, not a placement bug.

### Solve timeout

The ASTAP process timeout (`SOLVE_TIMEOUT_MS` in `server/astap.ts`) is **not** a "too slow" limit — it is only a safety net against a process that hangs forever. ASTAP terminates on its own when its search is exhausted (reporting "No solution"), and the user can cancel anytime via the `AbortSignal` (the frontend polls the job indefinitely, with no client-side cap). It is therefore set very generously (**30 min**): a hinted solve finishes in seconds, but a **blind all-sky search** (no target object) can take a couple of minutes — and much longer on a slow machine — so a short cap would kill healthy solves (the original flat 60 s did exactly that). Raise it further if a genuinely slow machine ever hits it; a blind solve is also far faster when a target object supplies a position hint.

## 2. EXIF orientation correction

Astrophoto JPEGs often carry an EXIF orientation tag (e.g., images from camera phones or export pipelines). Browsers apply this tag automatically, displaying the image in the corrected orientation. The photo's placement (its sky model, drawn by the photo layer) therefore works in **browser-display coordinates**, not raw pixel coordinates.

solve-field reads the JPEG raw pixel data **without** applying EXIF rotation. Its WCS solution and the resulting `(photoX, photoY)` correspondences are in **raw pixel coordinates**.

`rawToBrowserCoords` (`server/exif-utils.ts`, called from `server/routes/local-solve.ts`) bridges the gap, converting raw pixel coords to browser-display coords after solving.

### Orientation formulas

For raw image dimensions `rawW × rawH` (0-indexed):

| EXIF value | Meaning             | Correct formula              |
| ---------- | ------------------- | ---------------------------- |
| 1          | Normal, no rotation | `(rawX, rawY)`               |
| 2          | Mirror horizontal   | `(rawW-1-rawX, rawY)`        |
| 3          | 180° rotation       | `(rawW-1-rawX, rawH-1-rawY)` |
| 4          | Mirror vertical     | `(rawX, rawH-1-rawY)`        |
| 5          | Transpose           | `(rawY, rawX)`               |
| 6          | 90° CW              | `(rawH-1-rawY, rawX)`        |
| 7          | Anti-transpose      | `(rawH-1-rawY, rawW-1-rawX)` |
| 8          | 90° CCW (270° CW)   | `(rawY, rawW-1-rawX)`        |

### Where this correction is applied

The correction is applied in two places in `server/routes/local-solve.ts`, once for ASTAP and once for solve-field, immediately after the solver returns:

```typescript
if (result.success && result.correspondences && meta.orientation && meta.orientation !== 1) {
  result.correspondences = result.correspondences.map((c) => {
    const { x, y } = rawToBrowserCoords(c.photoX, c.photoY, width, height, meta.orientation!);
    return { ...c, photoX: x, photoY: y };
  });
}
```

---

## Diagnostic: does a new image place correctly?

If a newly solved image appears misaligned, check in order:

1. **180° rotation (or "double mirror")** → EXIF orientation issue. Check `meta.orientation` via `sharp(buffer).metadata()`. If it is 6 or 8, verify `rawToBrowserCoords` with the table above.

2. **Skewed "parallelogram" overlay (consistent across photos), ASTAP only** → a **sheared CD matrix** false match, _not_ a Y-flip. ASTAP solved at the wrong scale. Confirm with `CROTA1 ≠ CROTA2` in the raw `.wcs`; this should now be rejected by the conformality guard (§1b). Do **not** try to fix it by flipping `fitsYConvention`.

3. **Vertical flip only** (true mirror, same size) → wrong `fitsYConvention`. For solve-field/astrometry.net + JPEG this should never happen (always `false`); ASTAP and metadata extraction from FITS pass `true`. Verify the flag passed to `wcsToCorrespondences`.

4. **Slight rotation/scale error but correct region** → SIP distortion coefficients not being applied (the WCS has higher-order corrections that we currently skip).

5. **Completely wrong region of sky** → solve-field found a false match. Re-run with a tighter RA/Dec hint.

## Reading a header without a solution, and checking the file

`packages/core/src/fits-header.ts` reads a FITS header (FITS file, TIFF tag 270, XISF keywords) whether or not it holds a
plate solution: the capture data (`captureFromHeader`: sub exposure from `EXPTIME`/`EXPOSURE`, frames from
`STACKCNT`/`NCOMBINE`/`LIVETIME` ÷ exposure), the facts used to check the file (`headerFacts`: `OBJECT`, centre,
`FOCALLEN`, `XPIXSZ`, `XBINNING`, `TELESCOP`, `INSTRUME`, `NAXIS`), the raw cards (`parseFitsCards`) and a truncated FITS
(`fitsDataTruncated`). `solveWcs` and `convert` return all of it on failure too.

`packages/core/src/wcs-file-checks.ts` compares a file with the photo it is read for (`wcsFileWarnings`) and picks the
saved setup the header points to (`suggestGearSetup`). Both apps run them through `packages/app-state/src/wcs-load-flow.ts`
(`readWcsFileForPhoto`), which asks about the warnings through a dialog the app passes in: the desktop's
`src/wcs-load-flow.ts` (add-photo card, metadata editor) and the phone's `useWcsLoad` (photo sheet, editor). A raw file
added as the photo itself skips the comparison. On the phone, a raw file without a plate solution waits to be placed
with its capture data, setup and header cards, given to the photo when it is placed (`storePlacedPendingPhoto`).
