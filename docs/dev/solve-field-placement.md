# solve-field Placement: Coordinate Conventions and EXIF Orientation

## How placement works

When solve-field solves a JPEG/PNG, it writes a `.wcs` FITS file containing the WCS (World Coordinate System) solution. `server/wcs-reader.ts` then inverts this solution to produce **star correspondences**: pairs of `(photoX, photoY)` ↔ `(RA, Dec)` that tell the frontend affine transform where to place the image on the sky map.

Two independent coordinate-system issues must be handled correctly:

1. **Y-axis convention** in the WCS solution
2. **EXIF orientation** of the source JPEG

---

## 1. Y-axis convention: `fitsYConvention=false`

`wcsToCorrespondences(wcs, w, h, fitsYConvention)` converts sky coordinates back to image pixels. The `fitsYConvention` flag controls how FITS pixel coordinates map to display (screen) coordinates:

| Convention              | Y=1 at…             | Who uses it                                                |
| ----------------------- | ------------------- | ---------------------------------------------------------- |
| `fitsYConvention=true`  | **bottom** of image | PixInsight/Siril FITS files; **ASTAP** (`server/astap.ts`) |
| `fitsYConvention=false` | **top** of image    | solve-field, astrometry.net (JPEG/PNG input)               |

**ASTAP** uses the **same pixel convention as the Siril/PixInsight metadata path**. This was verified empirically: solving `M97+M108.jpg` with ASTAP and reading the embedded WCS of the same image in `M97+M108.tiff` (Siril) gave the **same `CDELT2` sign and scale**. Since the metadata path passes `true` (`extractWCS` → `wcsToCorrespondences(..., true)` in `server/index.ts`) and places correctly, `server/astap.ts` passes `true` as well.

**solve-field always writes its `.wcs` with Y=1 at the top row** when the input is a JPEG or PNG (the natural storage order of those formats). Therefore `server/solve-field.ts` passes `false` unconditionally:

```typescript
// solve-field receives a JPEG/PNG (screen/display convention):
// pixel (1,1) = upper-left, Y increases downward → fitsYConvention=false
const correspondences = wcsToCorrespondences(wcs, width, height, false);
```

The input to solve-field is **always** a JPEG or PNG (never a raw FITS file), so this value never needs to change.

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

Astrophoto JPEGs often carry an EXIF orientation tag (e.g., images from camera phones or export pipelines). Browsers apply this tag automatically, displaying the image in the corrected orientation. The CSS matrix transform in `src/photo-overlay.ts` therefore operates in **browser-display coordinates**, not raw pixel coordinates.

solve-field reads the JPEG raw pixel data **without** applying EXIF rotation. Its WCS solution and the resulting `(photoX, photoY)` correspondences are in **raw pixel coordinates**.

`rawToBrowserCoords` in `server/index.ts` bridges the gap, converting raw pixel coords to browser-display coords after solving.

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

The correction is applied in two places in `server/index.ts`, once for ASTAP and once for solve-field, immediately after the solver returns:

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
